import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Prisma, type TaxRegime } from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { PayrollConfigService } from './payroll-config.service';
import { writePayrollAudit } from './payroll-audit';
import { DECLARATION_PROVIDER, type DeclarationProvider } from './declaration-provider';
import {
  elapsedPeriodsInFinancialYear,
  financialYear as financialYearOf,
  monthsRemainingInFinancialYear,
} from './financial-year.util';
import type { TaxRegimeConfigRow, TaxSlabRow } from './tds-calculator';
import type { SetTdsRegimeDto } from './dto/payroll.dto';

const MANAGE_ROLES = ['COMPANY_ADMIN', 'HR_MANAGER'];

export interface EmployeeTdsContext {
  regime: TaxRegime;
  slabs: TaxSlabRow[];
  config: TaxRegimeConfigRow;
  declaredExemptions: number;
  elapsedGross: Prisma.Decimal;
  alreadyDeducted: Prisma.Decimal;
  remainingMonths: number;
}

@Injectable()
export class TdsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly config: PayrollConfigService,
    @Inject(DECLARATION_PROVIDER) private readonly declarations: DeclarationProvider,
  ) {}

  /** HR/Admin can read or set anyone's regime; an Employee only their own (module 07 §12 decision 8). */
  private assertCanAccess(user: AuthenticatedUser, employeeId: string) {
    if (MANAGE_ROLES.includes(user.role)) return;
    if (user.role === 'EMPLOYEE' && user.employeeId === employeeId) return;
    throw new ForbiddenException('Not authorized to access this TDS regime choice');
  }

  async getEmployeeRegime(employeeId: string, financialYear: string, user: AuthenticatedUser) {
    this.assertCanAccess(user, employeeId);
    const row = await this.tenantPrisma.client.tdsRegimeChoice.findUnique({
      where: {
        tenantId_employeeId_financialYear: {
          tenantId: this.tenantPrisma.tenantId,
          employeeId,
          financialYear,
        },
      },
    });
    return {
      employeeId,
      financialYear,
      regime: row?.regime ?? 'NEW',
      setByUserId: row?.setByUserId ?? null,
    };
  }

  async setEmployeeRegime(employeeId: string, dto: SetTdsRegimeDto, user: AuthenticatedUser) {
    this.assertCanAccess(user, employeeId);
    const tenantId = this.tenantPrisma.tenantId;
    // An HR/Admin user setting someone else's regime is an override (always
    // audited); an employee setting their own, or HR/Admin editing their
    // own employee record, is a plain self-service choice.
    const isOverride = MANAGE_ROLES.includes(user.role) && user.employeeId !== employeeId;

    const row = await this.tenantPrisma.client.tdsRegimeChoice.upsert({
      where: {
        tenantId_employeeId_financialYear: {
          tenantId,
          employeeId,
          financialYear: dto.financialYear,
        },
      },
      update: { regime: dto.regime, setByUserId: isOverride ? user.sub : null },
      create: {
        tenantId,
        employeeId,
        financialYear: dto.financialYear,
        regime: dto.regime,
        setByUserId: isOverride ? user.sub : null,
      },
    });

    if (isOverride) {
      await writePayrollAudit(
        this.tenantPrisma,
        user,
        'payroll.tds_regime_overridden',
        'employee',
        employeeId,
        { financialYear: dto.financialYear, regime: dto.regime },
      );
    }
    return row;
  }

  /**
   * Batched per-run TDS context for every employee in `employeeIds`, for
   * `PayrollRunService.assembleLineItems`/`recalculate` — one DB round trip
   * per input, same pattern as the existing `ptSlabsByState`/`lopMap`
   * batching (module 07 §9 Phase 6).
   */
  async buildContext(
    employeeIds: string[],
    period: string,
  ): Promise<Map<string, EmployeeTdsContext>> {
    const financialYear = financialYearOf(period);
    const elapsedPeriods = elapsedPeriodsInFinancialYear(period);
    const remainingMonths = monthsRemainingInFinancialYear(period);

    const [choices, taxConfig, historical] = await Promise.all([
      this.tenantPrisma.client.tdsRegimeChoice.findMany({
        where: { employeeId: { in: employeeIds }, financialYear },
      }),
      this.config.getTaxConfig(financialYear),
      elapsedPeriods.length
        ? this.tenantPrisma.client.payrollLineItem.findMany({
            where: {
              employeeId: { in: employeeIds },
              run: {
                period: { in: elapsedPeriods },
                isReprocess: false,
                status: { in: ['PROCESSED', 'DISBURSED'] },
              },
            },
            select: { employeeId: true, grossEarnings: true, tdsDeducted: true },
          })
        : Promise.resolve([]),
    ]);

    const regimeByEmployee = new Map(choices.map((c) => [c.employeeId, c.regime]));
    const historicalByEmployee = new Map<
      string,
      { grossSum: Prisma.Decimal; tdsSum: Prisma.Decimal }
    >();
    for (const row of historical) {
      const prev = historicalByEmployee.get(row.employeeId) ?? {
        grossSum: new Prisma.Decimal(0),
        tdsSum: new Prisma.Decimal(0),
      };
      historicalByEmployee.set(row.employeeId, {
        grossSum: prev.grossSum.plus(row.grossEarnings),
        tdsSum: prev.tdsSum.plus(row.tdsDeducted),
      });
    }

    const oldRegimeEmployeeIds = employeeIds.filter(
      (id) => (regimeByEmployee.get(id) ?? 'NEW') === 'OLD',
    );
    const declaredExemptionEntries = await Promise.all(
      oldRegimeEmployeeIds.map(
        async (id) =>
          [id, await this.declarations.getDeclaredExemptions(id, financialYear)] as const,
      ),
    );
    const declaredExemptionsByEmployee = new Map(declaredExemptionEntries);

    const contexts = new Map<string, EmployeeTdsContext>();
    for (const id of employeeIds) {
      const regime = regimeByEmployee.get(id) ?? 'NEW';
      const hist = historicalByEmployee.get(id);
      contexts.set(id, {
        regime,
        slabs: taxConfig[regime].slabs,
        config: taxConfig[regime].config,
        declaredExemptions: regime === 'OLD' ? (declaredExemptionsByEmployee.get(id) ?? 0) : 0,
        elapsedGross: hist?.grossSum ?? new Prisma.Decimal(0),
        alreadyDeducted: hist?.tdsSum ?? new Prisma.Decimal(0),
        remainingMonths,
      });
    }
    return contexts;
  }
}
