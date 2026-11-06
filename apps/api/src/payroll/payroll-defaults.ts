/**
 * Default payroll config seeded per tenant (onboarding, and lazily for
 * tenants created before Payroll existed). Everything here is tenant-editable
 * afterwards — these are starting values, never constants the engine reads.
 *
 * UNVERIFIED: the Professional Tax figures below are best-known values, not
 * yet reviewed by a payroll domain expert (Phase 9 review, docs/modules/
 * 07_PAYROLL_ENGINE.md §12 decision 11). States that levy PT but are not
 * listed (e.g. Tamil Nadu and Kerala, which charge half-yearly) are
 * intentionally not seeded — a Company Admin enters their slabs in Settings.
 * A state with no slabs means no PT is deducted.
 */

interface SlabSeed {
  from: number;
  to: number | null;
  amount: number;
  februaryAmount?: number;
}

// Slab applies when from <= monthly gross < to (to = null → open-ended).
export const DEFAULT_PT_SLABS: Record<string, SlabSeed[]> = {
  KARNATAKA: [
    { from: 0, to: 25000, amount: 0 },
    { from: 25000, to: null, amount: 200, februaryAmount: 300 },
  ],
  // Women's exemption below ₹25,000 is not modelled (no gender-keyed slabs yet).
  MAHARASHTRA: [
    { from: 0, to: 7501, amount: 0 },
    { from: 7501, to: 10001, amount: 175 },
    { from: 10001, to: null, amount: 200, februaryAmount: 300 },
  ],
  TELANGANA: [
    { from: 0, to: 15001, amount: 0 },
    { from: 15001, to: 20001, amount: 150 },
    { from: 20001, to: null, amount: 200 },
  ],
  ANDHRA_PRADESH: [
    { from: 0, to: 15001, amount: 0 },
    { from: 15001, to: 20001, amount: 150 },
    { from: 20001, to: null, amount: 200 },
  ],
  WEST_BENGAL: [
    { from: 0, to: 10001, amount: 0 },
    { from: 10001, to: 15001, amount: 110 },
    { from: 15001, to: 25001, amount: 130 },
    { from: 25001, to: 40001, amount: 150 },
    { from: 40001, to: null, amount: 200 },
  ],
  GUJARAT: [
    { from: 0, to: 12000, amount: 0 },
    { from: 12000, to: null, amount: 200 },
  ],
};

interface PayrollSeedClient {
  payrollSettings: { upsert(args: any): Promise<unknown> };
  professionalTaxSlab: { createMany(args: any): Promise<unknown> };
}

/** Idempotent: safe to call twice (settings upsert, slabs skip duplicates). */
export async function seedPayrollDefaults(client: PayrollSeedClient, tenantId: string) {
  await client.payrollSettings.upsert({
    where: { tenantId },
    update: {},
    create: { tenantId },
  });
  await client.professionalTaxSlab.createMany({
    data: Object.entries(DEFAULT_PT_SLABS).flatMap(([state, slabs]) =>
      slabs.map((s) => ({
        tenantId,
        state,
        grossFrom: s.from,
        grossTo: s.to,
        monthlyAmount: s.amount,
        februaryAmount: s.februaryAmount ?? null,
      })),
    ),
    skipDuplicates: true,
  });
}

/**
 * Default TDS slabs and regime config (module 07 Phase 6), seeded the same
 * shape for every financial year until a Company Admin edits it — same
 * posture as DEFAULT_PT_SLABS above, and the same UNVERIFIED disclaimer
 * (§12 decision 11, Phase 9 domain review). Figures are the Finance Act 2025
 * rules (FY2025-26 / AY2026-27: new regime 0–4L nil … >24L 30%, 87A rebate to
 * ₹12L max ₹60,000 with marginal relief, standard deduction ₹75,000; old
 * regime unchanged), assumed unchanged for FY2026-27. Not yet reviewed by a
 * tax expert — confirm before real TDS runs.
 */
interface TaxSlabSeed {
  from: number;
  to: number | null;
  ratePercent: number;
}

export const DEFAULT_TAX_SLABS: Record<'OLD' | 'NEW', TaxSlabSeed[]> = {
  NEW: [
    { from: 0, to: 400000, ratePercent: 0 },
    { from: 400000, to: 800000, ratePercent: 5 },
    { from: 800000, to: 1200000, ratePercent: 10 },
    { from: 1200000, to: 1600000, ratePercent: 15 },
    { from: 1600000, to: 2000000, ratePercent: 20 },
    { from: 2000000, to: 2400000, ratePercent: 25 },
    { from: 2400000, to: null, ratePercent: 30 },
  ],
  OLD: [
    { from: 0, to: 250000, ratePercent: 0 },
    { from: 250000, to: 500000, ratePercent: 5 },
    { from: 500000, to: 1000000, ratePercent: 20 },
    { from: 1000000, to: null, ratePercent: 30 },
  ],
};

export const DEFAULT_TAX_REGIME_CONFIG: Record<
  'OLD' | 'NEW',
  {
    standardDeduction: number;
    cessPercent: number;
    rebateThreshold: number;
    rebateMaxAmount: number;
  }
> = {
  NEW: {
    standardDeduction: 75000,
    cessPercent: 4,
    rebateThreshold: 1200000,
    rebateMaxAmount: 60000,
  },
  OLD: {
    standardDeduction: 50000,
    cessPercent: 4,
    rebateThreshold: 500000,
    rebateMaxAmount: 12500,
  },
};

interface TdsSeedClient {
  taxSlab: { createMany(args: any): Promise<unknown> };
  taxRegimeConfig: { createMany(args: any): Promise<unknown> };
}

/** Idempotent per (tenantId, financialYear): safe to call twice, both createMany skip duplicates. */
export async function seedTdsDefaults(
  client: TdsSeedClient,
  tenantId: string,
  financialYear: string,
) {
  await client.taxSlab.createMany({
    data: (Object.entries(DEFAULT_TAX_SLABS) as Array<['OLD' | 'NEW', TaxSlabSeed[]]>).flatMap(
      ([regime, slabs]) =>
        slabs.map((s) => ({
          tenantId,
          financialYear,
          regime,
          incomeFrom: s.from,
          incomeTo: s.to,
          ratePercent: s.ratePercent,
        })),
    ),
    skipDuplicates: true,
  });
  await client.taxRegimeConfig.createMany({
    data: (
      Object.entries(DEFAULT_TAX_REGIME_CONFIG) as Array<
        ['OLD' | 'NEW', (typeof DEFAULT_TAX_REGIME_CONFIG)['OLD']]
      >
    ).map(([regime, cfg]) => ({
      tenantId,
      financialYear,
      regime,
      standardDeduction: cfg.standardDeduction,
      cessPercent: cfg.cessPercent,
      rebateThreshold: cfg.rebateThreshold,
      rebateMaxAmount: cfg.rebateMaxAmount,
    })),
    skipDuplicates: true,
  });
}
