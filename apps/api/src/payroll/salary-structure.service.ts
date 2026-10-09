import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { PayrollConfigService } from './payroll-config.service';
import { writePayrollAudit } from './payroll-audit';
import { BASIC_CODE, resolveMonthlyAmounts } from './salary-components.util';
import { normalizeAndValidateComponents } from './salary-structure.validation';
import { calculatePayroll } from './payroll-calculator';
import type { ReviseSalaryStructureDto, UpsertSalaryStructureDto } from './dto/payroll.dto';

const MANAGE_ROLES = ['COMPANY_ADMIN', 'HR_MANAGER'];

@Injectable()
export class SalaryStructureService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly config: PayrollConfigService,
  ) {}

  /** HR/Admin see anyone's structure; an Employee only their own. */
  private assertCanRead(user: AuthenticatedUser, employeeId: string) {
    if (MANAGE_ROLES.includes(user.role)) return;
    if (user.role === 'EMPLOYEE' && user.employeeId === employeeId) return;
    throw new ForbiddenException('Not authorized to view this salary structure');
  }

  private async assertEmployeeExists(employeeId: string) {
    const employee = await this.tenantPrisma.client.employee.findUnique({
      where: { id: employeeId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
  }

  private findActive(employeeId: string) {
    return this.tenantPrisma.client.salaryStructure.findFirst({
      where: { employeeId, status: 'ACTIVE' },
      include: { components: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  private toResponse(
    structure: NonNullable<Awaited<ReturnType<SalaryStructureService['findActive']>>>,
  ) {
    const amounts = resolveMonthlyAmounts(structure.components, structure.ctcAnnual);
    const monthlyCtc = structure.ctcAnnual.div(12);
    return {
      ...structure,
      monthlyCtc,
      basicPercentOfCtc: monthlyCtc.isZero()
        ? null
        : amounts.get(BASIC_CODE)!.div(monthlyCtc).times(100).toDecimalPlaces(2),
      components: structure.components.map((c) => ({
        ...c,
        monthlyAmount: amounts.get(c.code)!.toDecimalPlaces(2),
      })),
    };
  }

  async get(employeeId: string, user: AuthenticatedUser) {
    this.assertCanRead(user, employeeId);
    await this.assertEmployeeExists(employeeId);
    const structure = await this.findActive(employeeId);
    if (!structure) throw new NotFoundException('No salary structure for this employee yet');
    return this.toResponse(structure);
  }

  async create(employeeId: string, dto: UpsertSalaryStructureDto, user: AuthenticatedUser) {
    await this.assertEmployeeExists(employeeId);
    if (await this.findActive(employeeId)) {
      throw new ConflictException('This employee already has an active salary structure');
    }
    const settings = await this.config.getSettings();
    const components = normalizeAndValidateComponents(
      dto.components,
      dto.ctcAnnual,
      settings.minBasicPercent,
    );
    const tenantId = this.tenantPrisma.tenantId;

    let created;
    try {
      created = await this.tenantPrisma.client.salaryStructure.create({
        data: {
          tenantId,
          employeeId,
          ctcAnnual: dto.ctcAnnual,
          effectiveFrom: new Date(dto.effectiveFrom),
          components: { create: components.map((c) => ({ tenantId, ...c })) },
        },
        include: { components: { orderBy: { sortOrder: 'asc' } } },
      });
    } catch (e) {
      // A concurrent create lost the partial-unique-index race.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('This employee already has an active salary structure');
      }
      throw e;
    }

    await writePayrollAudit(
      this.tenantPrisma,
      user,
      'payroll.salary_structure_created',
      'employee',
      employeeId,
      {
        componentCount: components.length,
      },
    );
    return this.toResponse(created);
  }

  /**
   * Edits the active structure in place. Safe only while no payroll run has
   * used it — once runs exist (Phase 3+), changes must go through a revision
   * (`POST .../revise`, Phase 7) so history is never rewritten.
   */
  async update(employeeId: string, dto: UpsertSalaryStructureDto, user: AuthenticatedUser) {
    await this.assertEmployeeExists(employeeId);
    const active = await this.findActive(employeeId);
    if (!active) throw new NotFoundException('No salary structure for this employee yet');

    const settings = await this.config.getSettings();
    const components = normalizeAndValidateComponents(
      dto.components,
      dto.ctcAnnual,
      settings.minBasicPercent,
    );
    const tenantId = this.tenantPrisma.tenantId;

    const updated = await this.tenantPrisma.client.salaryStructure.update({
      where: { id: active.id },
      data: {
        ctcAnnual: dto.ctcAnnual,
        effectiveFrom: new Date(dto.effectiveFrom),
        components: {
          deleteMany: {},
          create: components.map((c) => ({ tenantId, ...c })),
        },
      },
      include: { components: { orderBy: { sortOrder: 'asc' } } },
    });

    await writePayrollAudit(
      this.tenantPrisma,
      user,
      'payroll.salary_structure_updated',
      'employee',
      employeeId,
      {
        componentCount: components.length,
      },
    );
    return this.toResponse(updated);
  }

  /**
   * Supersedes the active structure with a new one, recording the change as
   * an append-only `SalaryRevision` (module 07 Phase 7) instead of editing
   * history. If `effectiveDate` falls at or before a period this employee
   * already has a `PROCESSED`/`DISBURSED` (non-reprocess) line item for,
   * generates one `ArrearsLineItem` per such period — the delta between
   * what was paid under the OLD structure and what the NEW structure would
   * pay, recomputed with the SAME historical workingDays/payableDays/month
   * and CURRENT EPF/ESI/PT config on both sides (so the delta isolates the
   * structure change — TDS, overtime and ad-hoc adjustments are
   * deliberately excluded from both sides and so cancel out of the
   * comparison; see §12 decision 25). Arrears sit `PENDING` until the next
   * `createDraft` folds them into that run's `adHocAdjustments` — never a
   * rewrite of the original (already-immutable) `PayrollLineItem` (INV-2).
   */
  async revise(employeeId: string, dto: ReviseSalaryStructureDto, user: AuthenticatedUser) {
    await this.assertEmployeeExists(employeeId);
    const active = await this.findActive(employeeId);
    if (!active) {
      throw new NotFoundException('No salary structure for this employee yet — create one first');
    }

    const settings = await this.config.getSettings();
    const components = normalizeAndValidateComponents(
      dto.components,
      dto.ctcAnnual,
      settings.minBasicPercent,
    );
    const tenantId = this.tenantPrisma.tenantId;
    const effectiveDate = new Date(dto.effectiveDate);
    const effectivePeriod = dto.effectiveDate.slice(0, 7); // YYYY-MM

    const employee = await this.tenantPrisma.client.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { workState: true },
    });
    const [affectedItems, ptSlabs] = await Promise.all([
      this.tenantPrisma.client.payrollLineItem.findMany({
        where: {
          employeeId,
          run: {
            isReprocess: false,
            status: { in: ['PROCESSED', 'DISBURSED'] },
            period: { gte: effectivePeriod },
          },
        },
        include: { run: { select: { id: true, period: true } } },
        orderBy: { run: { period: 'asc' } },
      }),
      employee.workState
        ? this.tenantPrisma.client.professionalTaxSlab.findMany({
            where: { state: employee.workState },
            orderBy: { grossFrom: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    const epf = {
      ceiling: settings.epfCeiling,
      allowAboveCeiling: settings.allowEpfAboveCeiling,
      employeeRate: settings.epfEmployeeRate,
      epsRate: settings.epsRate,
      employerRate: settings.epfEmployerRate,
      adminRate: settings.epfAdminRate,
      edliRate: settings.edliRate,
    };
    const esi = {
      wageCeiling: settings.esiWageCeiling,
      employeeRate: settings.esiEmployeeRate,
      employerRate: settings.esiEmployerRate,
    };

    const revisionId = randomUUID();
    const newStructureId = randomUUID();
    const arrears = affectedItems.map((item) => {
      const month = Number(item.run.period.split('-')[1]);
      const previous = calculatePayroll({
        components: active.components,
        ctcAnnual: active.ctcAnnual,
        workingDays: item.workingDays,
        payableDays: item.payableDays,
        epf,
        esi,
        ptSlabs,
        month,
        allowNegativeNet: true,
      });
      const revised = calculatePayroll({
        components,
        ctcAnnual: dto.ctcAnnual,
        workingDays: item.workingDays,
        payableDays: item.payableDays,
        epf,
        esi,
        ptSlabs,
        month,
        allowNegativeNet: true,
      });
      return {
        id: randomUUID(),
        tenantId,
        employeeId,
        revisionId,
        period: item.run.period,
        originalRunId: item.run.id,
        previousNetPay: previous.netPay,
        revisedNetPay: revised.netPay,
        amount: revised.netPay.minus(previous.netPay),
      };
    });

    await this.tenantPrisma.transaction((tx) => [
      tx.salaryStructure.update({ where: { id: active.id }, data: { status: 'SUPERSEDED' } }),
      tx.salaryStructure.create({
        data: {
          id: newStructureId,
          tenantId,
          employeeId,
          ctcAnnual: dto.ctcAnnual,
          effectiveFrom: effectiveDate,
          components: { create: components.map((c) => ({ tenantId, ...c })) },
        },
      }),
      tx.salaryRevision.create({
        data: {
          id: revisionId,
          tenantId,
          employeeId,
          previousStructureId: active.id,
          newStructureId,
          effectiveDate,
          reason: dto.reason,
          approvedBy: user.sub,
        },
      }),
      ...(arrears.length ? [tx.arrearsLineItem.createMany({ data: arrears })] : []),
    ]);

    await writePayrollAudit(
      this.tenantPrisma,
      user,
      'payroll.salary_structure_revised',
      'employee',
      employeeId,
      {
        revisionId,
        effectiveDate: dto.effectiveDate,
        arrearsPeriods: arrears.map((a) => a.period),
      },
    );

    return {
      revisionId,
      newStructureId,
      arrearsGenerated: arrears.length,
      arrearsPeriods: arrears.map((a) => a.period),
    };
  }
}
