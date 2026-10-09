import { BadRequestException, Injectable } from '@nestjs/common';
import type { IndianState, TaxRegime, TaxRegimeConfig, TaxSlab } from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { writePayrollAudit } from './payroll-audit';
import { seedPayrollDefaults, seedTdsDefaults } from './payroll-defaults';
import type {
  PtSlabDto,
  TaxSlabDto,
  UpdatePayrollSettingsDto,
  UpdateTaxRegimeConfigDto,
} from './dto/payroll.dto';

/**
 * Slabs must start at 0, be contiguous (each slab starts where the previous
 * ends) and end with one open-ended slab — otherwise a gross falling in a gap
 * would silently deduct no Professional Tax.
 */
export function validatePtSlabs(slabs: PtSlabDto[]): PtSlabDto[] {
  const sorted = [...slabs].sort((a, b) => a.grossFrom - b.grossFrom);
  if (sorted[0].grossFrom !== 0) {
    throw new BadRequestException('The first slab must start at 0');
  }
  sorted.forEach((slab, i) => {
    const isLast = i === sorted.length - 1;
    const to = slab.grossTo ?? null;
    if (isLast) {
      if (to !== null)
        throw new BadRequestException('The last slab must be open-ended (no grossTo)');
      return;
    }
    if (to === null) {
      throw new BadRequestException('Only the last slab may be open-ended');
    }
    if (to <= slab.grossFrom) {
      throw new BadRequestException(`Slab starting at ${slab.grossFrom} must end after it starts`);
    }
    if (to !== sorted[i + 1].grossFrom) {
      throw new BadRequestException(
        `Slabs must be contiguous: the slab ending at ${to} is not followed by one starting at ${to}`,
      );
    }
  });
  return sorted;
}

/**
 * Same contiguity rules as `validatePtSlabs`, for income-tax slabs
 * (`incomeFrom`/`incomeTo`/`ratePercent` instead of `grossFrom`/`grossTo`/
 * `monthlyAmount`) — kept as its own function rather than a shared generic,
 * same per-module-copy posture as the rest of this codebase.
 */
export function validateTaxSlabs(slabs: TaxSlabDto[]): TaxSlabDto[] {
  const sorted = [...slabs].sort((a, b) => a.incomeFrom - b.incomeFrom);
  if (sorted[0].incomeFrom !== 0) {
    throw new BadRequestException('The first slab must start at 0');
  }
  sorted.forEach((slab, i) => {
    const isLast = i === sorted.length - 1;
    const to = slab.incomeTo ?? null;
    if (isLast) {
      if (to !== null)
        throw new BadRequestException('The last slab must be open-ended (no incomeTo)');
      return;
    }
    if (to === null) {
      throw new BadRequestException('Only the last slab may be open-ended');
    }
    if (to <= slab.incomeFrom) {
      throw new BadRequestException(`Slab starting at ${slab.incomeFrom} must end after it starts`);
    }
    if (to !== sorted[i + 1].incomeFrom) {
      throw new BadRequestException(
        `Slabs must be contiguous: the slab ending at ${to} is not followed by one starting at ${to}`,
      );
    }
  });
  return sorted;
}

@Injectable()
export class PayrollConfigService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /**
   * Tenants created before Payroll existed have no settings row — seed the
   * defaults on first read. Only when the row is absent, so a slab a Company
   * Admin deliberately removed is never re-seeded.
   */
  async getSettings() {
    const tenantId = this.tenantPrisma.tenantId;
    const client = this.tenantPrisma.client;
    const existing = await client.payrollSettings.findUnique({ where: { tenantId } });
    if (existing) return existing;
    await seedPayrollDefaults(client, tenantId);
    return client.payrollSettings.findUniqueOrThrow({ where: { tenantId } });
  }

  async updateSettings(dto: UpdatePayrollSettingsDto, user: AuthenticatedUser) {
    await this.getSettings();
    const updated = await this.tenantPrisma.client.payrollSettings.update({
      where: { tenantId: this.tenantPrisma.tenantId },
      data: dto,
    });
    await writePayrollAudit(
      this.tenantPrisma,
      user,
      'payroll.settings_updated',
      'payroll_settings',
      undefined,
      {
        fields: Object.keys(dto),
      },
    );
    return updated;
  }

  async listPtSlabs(state?: IndianState) {
    await this.getSettings();
    return this.tenantPrisma.client.professionalTaxSlab.findMany({
      where: state ? { state } : {},
      orderBy: [{ state: 'asc' }, { grossFrom: 'asc' }],
    });
  }

  async replacePtSlabs(state: IndianState, slabs: PtSlabDto[], user: AuthenticatedUser) {
    const sorted = validatePtSlabs(slabs);
    await this.getSettings();
    const tenantId = this.tenantPrisma.tenantId;

    await this.tenantPrisma.transaction((tx) => [
      tx.professionalTaxSlab.deleteMany({ where: { tenantId, state } }),
      tx.professionalTaxSlab.createMany({
        data: sorted.map((s) => ({
          tenantId,
          state,
          grossFrom: s.grossFrom,
          grossTo: s.grossTo ?? null,
          monthlyAmount: s.monthlyAmount,
          februaryAmount: s.februaryAmount ?? null,
        })),
      }),
    ]);

    await writePayrollAudit(
      this.tenantPrisma,
      user,
      'payroll.pt_slabs_replaced',
      'payroll_pt_slabs',
      state,
      {
        state,
        slabCount: sorted.length,
      },
    );
    return this.listPtSlabs(state);
  }

  /**
   * TDS config for a financial year, both regimes (module 07 Phase 6).
   * Seeded lazily on first read for that FY, same posture as `getSettings`
   * — only when nothing exists yet, so a Company Admin's edits are never
   * silently re-seeded.
   */
  async getTaxConfig(
    financialYear: string,
  ): Promise<Record<TaxRegime, { slabs: TaxSlab[]; config: TaxRegimeConfig }>> {
    const tenantId = this.tenantPrisma.tenantId;
    const client = this.tenantPrisma.client;
    const [slabs, configs] = await Promise.all([
      client.taxSlab.findMany({
        where: { tenantId, financialYear },
        orderBy: [{ regime: 'asc' }, { incomeFrom: 'asc' }],
      }),
      client.taxRegimeConfig.findMany({ where: { tenantId, financialYear } }),
    ]);
    if (slabs.length === 0 && configs.length === 0) {
      await seedTdsDefaults(client, tenantId, financialYear);
      return this.getTaxConfig(financialYear);
    }
    const byRegime = (regime: TaxRegime) => ({
      slabs: slabs.filter((s) => s.regime === regime),
      config: configs.find((c) => c.regime === regime)!,
    });
    return { OLD: byRegime('OLD'), NEW: byRegime('NEW') };
  }

  async replaceTaxSlabs(
    financialYear: string,
    regime: TaxRegime,
    slabs: TaxSlabDto[],
    user: AuthenticatedUser,
  ) {
    const sorted = validateTaxSlabs(slabs);
    await this.getTaxConfig(financialYear);
    const tenantId = this.tenantPrisma.tenantId;

    await this.tenantPrisma.transaction((tx) => [
      tx.taxSlab.deleteMany({ where: { tenantId, financialYear, regime } }),
      tx.taxSlab.createMany({
        data: sorted.map((s) => ({
          tenantId,
          financialYear,
          regime,
          incomeFrom: s.incomeFrom,
          incomeTo: s.incomeTo ?? null,
          ratePercent: s.ratePercent,
        })),
      }),
    ]);

    await writePayrollAudit(
      this.tenantPrisma,
      user,
      'payroll.tax_slabs_replaced',
      'payroll_tax_slabs',
      `${financialYear}:${regime}`,
      { financialYear, regime, slabCount: sorted.length },
    );
    return this.getTaxConfig(financialYear);
  }

  async updateTaxRegimeConfig(
    financialYear: string,
    regime: TaxRegime,
    dto: UpdateTaxRegimeConfigDto,
    user: AuthenticatedUser,
  ) {
    await this.getTaxConfig(financialYear);
    const tenantId = this.tenantPrisma.tenantId;

    await this.tenantPrisma.client.taxRegimeConfig.update({
      where: { tenantId_financialYear_regime: { tenantId, financialYear, regime } },
      data: dto,
    });

    await writePayrollAudit(
      this.tenantPrisma,
      user,
      'payroll.tax_regime_config_updated',
      'payroll_tax_regime_config',
      `${financialYear}:${regime}`,
      { financialYear, regime, fields: Object.keys(dto) },
    );
    return this.getTaxConfig(financialYear);
  }
}
