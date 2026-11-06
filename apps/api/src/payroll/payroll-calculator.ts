import { Prisma } from '@prisma/client';
import { BASIC_CODE, resolveMonthlyAmounts, type ComponentInput } from './salary-components.util';
import { resolveProfessionalTax, type PtSlabRow } from './professional-tax.util';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/**
 * Employer-side cost-provision types (module 07 §4.2) are part of CTC but
 * are never paid to the employee — they don't belong in gross pay, LOP
 * proration, or any statutory wage base computed from gross.
 */
const EMPLOYER_COST_TYPES = new Set(['PF_EMPLOYER', 'ESI_EMPLOYER', 'GRATUITY_PROVISION']);

export interface CalculatorComponent extends ComponentInput {
  type: string;
}

export interface EpfConfig {
  ceiling: Decimal | number | string;
  allowAboveCeiling: boolean;
  employeeRate: Decimal | number | string;
  epsRate: Decimal | number | string;
  employerRate: Decimal | number | string;
  adminRate: Decimal | number | string;
  edliRate: Decimal | number | string;
}

export interface EsiConfig {
  wageCeiling: Decimal | number | string;
  employeeRate: Decimal | number | string;
  employerRate: Decimal | number | string;
}

/** Approved CASH overtime hours for the period (module 07 Phase 4, decision 6). */
export interface OvertimeInput {
  hours: Decimal | number | string;
  /** fullMonthlyBasic ÷ (workingDays × shiftHoursPerDay) — the caller resolves this. */
  hourlyRate: Decimal | number | string;
  multiplier: Decimal | number | string;
}

export interface PayrollCalculationInput {
  components: CalculatorComponent[];
  ctcAnnual: Decimal | number | string;
  /** Working days in the full period (the proration denominator). */
  workingDays: number;
  /** Working days actually payable: employed sub-range minus whole-day LOP. */
  payableDays: number;
  epf: EpfConfig;
  esi: EsiConfig;
  ptSlabs: PtSlabRow[];
  /** 1-indexed; drives February PT amounts. */
  month: number;
  /** Omitted/undefined or 0 hours = no overtime (module 07 Phase 4). */
  overtime?: OvertimeInput;
  /** The caller supplies the real monthly figure (module 07 Phase 6, `computeMonthlyTds`); defaults to 0. */
  tds?: Decimal | number | string;
  /** Decision: net pay going negative is a data/config error, not silently clamped. */
  allowNegativeNet?: boolean;
}

export interface PayrollCalculationResult {
  workingDays: number;
  payableDays: number;
  payableFactor: Decimal;
  earnings: Array<{
    type: string;
    code: string;
    fullMonthlyAmount: Decimal;
    proratedAmount: Decimal;
  }>;
  grossEarnings: Decimal;
  lopDeduction: Decimal;
  /** The `OVERTIME` earning line's amount, 0 if none (also folded into `earnings`/`grossEarnings`). */
  overtimePay: Decimal;
  epf: {
    wages: Decimal;
    employeeContribution: Decimal;
    epsContribution: Decimal;
    employerPfContribution: Decimal;
    adminCharge: Decimal;
    edliContribution: Decimal;
  };
  esi: {
    applicable: boolean;
    wages: Decimal;
    employeeContribution: Decimal;
    employerContribution: Decimal;
  };
  professionalTax: Decimal;
  tds: Decimal;
  totalDeductions: Decimal;
  netPay: Decimal;
}

export class PayrollCalculationError extends Error {}

/** EPFO/ESIC contributions are conventionally rounded to the nearest rupee. */
function roundRupee(value: Decimal): Decimal {
  return value.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
}

function roundPaise(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Pure calculation of one employee's payroll line items for one period.
 * No DB access — every input is a plain value the caller (Phase 3's run
 * service) resolves from the structure, config, and attendance/leave data.
 */
export function calculatePayroll(input: PayrollCalculationInput): PayrollCalculationResult {
  if (input.payableDays > input.workingDays) {
    throw new PayrollCalculationError('payableDays cannot exceed workingDays');
  }
  if (input.workingDays < 0 || input.payableDays < 0) {
    throw new PayrollCalculationError('workingDays and payableDays cannot be negative');
  }

  const amounts = resolveMonthlyAmounts(input.components, input.ctcAnnual);
  const payableFactor =
    input.workingDays === 0 ? new D(0) : new D(input.payableDays).div(input.workingDays);

  const earnings = input.components
    .filter((c) => !EMPLOYER_COST_TYPES.has(c.type))
    .map((c) => {
      const fullMonthlyAmount = amounts.get(c.code)!;
      return {
        type: c.type,
        code: c.code,
        fullMonthlyAmount: roundPaise(fullMonthlyAmount),
        proratedAmount: roundPaise(fullMonthlyAmount.times(payableFactor)),
      };
    });

  // Overtime (decision 6): hours × hourlyRate × multiplier, additive —
  // never prorated by payableFactor (it's already a fixed hours-based
  // amount, independent of LOP). Included in ESI wages and PT, excluded
  // from EPF wages (EPF wages above is Basic-only, unaffected by this).
  const overtimeHours = input.overtime ? new D(input.overtime.hours) : new D(0);
  let overtimePay = new D(0);
  if (overtimeHours.gt(0)) {
    overtimePay = roundPaise(
      overtimeHours.times(input.overtime!.hourlyRate).times(input.overtime!.multiplier),
    );
    earnings.push({
      type: 'CUSTOM',
      code: 'OVERTIME',
      fullMonthlyAmount: overtimePay,
      proratedAmount: overtimePay,
    });
  }

  const fullGross = earnings.reduce((sum, e) => sum.plus(e.fullMonthlyAmount), new D(0));
  const grossEarnings = earnings.reduce((sum, e) => sum.plus(e.proratedAmount), new D(0));
  const lopDeduction = roundPaise(fullGross.minus(grossEarnings));

  // --- EPF: wages = prorated Basic only (decision 16 — no DA type in V1) ---
  const basicEarning = earnings.find((e) => e.code === BASIC_CODE);
  const proratedBasic = basicEarning ? basicEarning.proratedAmount : new D(0);
  const epfCeiling = new D(input.epf.ceiling);
  const epfWages = input.epf.allowAboveCeiling ? proratedBasic : D.min(proratedBasic, epfCeiling);
  const epfEmployeeContribution = roundRupee(
    epfWages.times(new D(input.epf.employeeRate)).div(100),
  );
  const epsContribution = roundRupee(epfWages.times(new D(input.epf.epsRate)).div(100));
  const employerPfContribution = roundRupee(epfWages.times(new D(input.epf.employerRate)).div(100));
  const adminCharge = roundRupee(epfWages.times(new D(input.epf.adminRate)).div(100));
  const edliContribution = roundRupee(epfWages.times(new D(input.epf.edliRate)).div(100));

  // --- ESI: eligibility checked against the FULL monthly gross (decision
  // 11 risk: real ESI practice keeps an employee covered for the whole
  // contribution period once enrolled, even if wages fluctuate — not
  // modelled here; revisit at the Phase 9 domain review). Contribution is
  // computed on the gross actually paid. ---
  const esiCeiling = new D(input.esi.wageCeiling);
  const esiApplicable = fullGross.lte(esiCeiling);
  const esiWages = esiApplicable ? grossEarnings : new D(0);
  const esiEmployeeContribution = esiApplicable
    ? roundRupee(esiWages.times(new D(input.esi.employeeRate)).div(100))
    : new D(0);
  const esiEmployerContribution = esiApplicable
    ? roundRupee(esiWages.times(new D(input.esi.employerRate)).div(100))
    : new D(0);

  const professionalTax = roundRupee(
    resolveProfessionalTax(grossEarnings, input.month, input.ptSlabs),
  );

  const tds = new D(input.tds ?? 0);

  const totalDeductions = epfEmployeeContribution
    .plus(esiEmployeeContribution)
    .plus(professionalTax)
    .plus(tds);
  const netPay = grossEarnings.minus(totalDeductions);

  if (netPay.lt(0) && !input.allowNegativeNet) {
    throw new PayrollCalculationError(
      `Net pay would be negative (${netPay.toString()}) — check LOP days, structure, and deductions`,
    );
  }

  return {
    workingDays: input.workingDays,
    payableDays: input.payableDays,
    payableFactor: payableFactor.toDecimalPlaces(4),
    earnings,
    grossEarnings,
    lopDeduction,
    overtimePay,
    epf: {
      wages: epfWages,
      employeeContribution: epfEmployeeContribution,
      epsContribution,
      employerPfContribution,
      adminCharge,
      edliContribution,
    },
    esi: {
      applicable: esiApplicable,
      wages: esiWages,
      employeeContribution: esiEmployeeContribution,
      employerContribution: esiEmployerContribution,
    },
    professionalTax,
    tds,
    totalDeductions,
    netPay,
  };
}
