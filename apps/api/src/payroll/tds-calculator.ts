import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export interface TaxSlabRow {
  incomeFrom: Decimal | number | string;
  incomeTo: Decimal | number | string | null;
  ratePercent: Decimal | number | string;
}

export interface TaxRegimeConfigRow {
  standardDeduction: Decimal | number | string;
  cessPercent: Decimal | number | string;
  rebateThreshold: Decimal | number | string;
  rebateMaxAmount: Decimal | number | string;
}

/** EPFO/ESIC-style rounding to the nearest rupee, same convention as the main calculator. */
function roundRupee(value: Decimal): Decimal {
  return value.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
}

/** Progressive slab tax on `taxableIncome`, before cess and the 87A rebate. */
function slabTax(taxableIncome: Decimal, slabs: TaxSlabRow[]): Decimal {
  let tax = new D(0);
  for (const s of slabs) {
    const from = new D(s.incomeFrom);
    const to = s.incomeTo == null ? null : new D(s.incomeTo);
    if (taxableIncome.lte(from)) continue;
    const upper = to === null ? taxableIncome : D.min(taxableIncome, to);
    const taxableInSlab = upper.minus(from);
    if (taxableInSlab.lte(0)) continue;
    tax = tax.plus(taxableInSlab.times(new D(s.ratePercent)).div(100));
  }
  return tax;
}

export interface AnnualTaxProjectionInput {
  projectedAnnualGross: Decimal | number | string;
  /** OLD regime only; caller passes 0 for NEW (module 07 §9 Phase 6). */
  declaredExemptions: Decimal | number | string;
  slabs: TaxSlabRow[];
  config: TaxRegimeConfigRow;
}

/** Annual tax (with cess and the 87A rebate applied), before crediting TDS already deducted. */
export function projectAnnualTax(input: AnnualTaxProjectionInput): Decimal {
  const taxableIncome = D.max(
    0,
    new D(input.projectedAnnualGross)
      .minus(input.config.standardDeduction)
      .minus(input.declaredExemptions),
  );
  let tax = slabTax(taxableIncome, input.slabs);

  if (taxableIncome.lte(input.config.rebateThreshold)) {
    tax = D.max(0, tax.minus(input.config.rebateMaxAmount));
  }

  return tax.plus(tax.times(input.config.cessPercent).div(100));
}

export interface MonthlyTdsInput {
  regime: 'OLD' | 'NEW';
  /** This month's actual (prorated) gross — the one month already known. */
  currentMonthGross: Decimal | number | string;
  /** Sum of gross already paid in earlier months of this FY. 0 in April. */
  elapsedGross: Decimal | number | string;
  /** Sum of TDS already deducted in earlier months of this FY. 0 in April. */
  alreadyDeducted: Decimal | number | string;
  /** Months left in the FY, including this one (April = 12, March = 1). */
  remainingMonths: number;
  declaredExemptions: Decimal | number | string;
  slabs: TaxSlabRow[];
  config: TaxRegimeConfigRow;
}

/**
 * Annual projection, smoothed over the months remaining in the FY and
 * crediting whatever TDS was already deducted — the standard "projected
 * tax minus deducted-so-far, divided by remaining months" formula (module
 * 07 §9 Phase 6). The annual projection assumes every remaining month
 * (including this one) pays the same gross as this month; a salary
 * revision changes `currentMonthGross` and so re-projects correctly from
 * the next run.
 *
 * Never negative — a drop in projected tax (e.g. a mid-year regime change,
 * or TDS already deducted exceeding the revised projection) means ₹0 TDS
 * for the rest of the year, never a refund paid through payroll.
 */
export function computeMonthlyTds(input: MonthlyTdsInput): Decimal {
  if (input.remainingMonths <= 0) return new D(0);

  const projectedAnnualGross = new D(input.elapsedGross).plus(
    new D(input.currentMonthGross).times(input.remainingMonths),
  );
  const annualTax = projectAnnualTax({
    projectedAnnualGross,
    declaredExemptions: input.regime === 'OLD' ? input.declaredExemptions : 0,
    slabs: input.slabs,
    config: input.config,
  });

  const remainingTax = annualTax.minus(input.alreadyDeducted);
  if (remainingTax.lte(0)) return new D(0);
  return roundRupee(remainingTax.div(input.remainingMonths));
}
