import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/**
 * Years of service between two UTC dates for the Payment of Gratuity Act
 * formula — calendar-anniversary based (not a raw ms/365.25 division),
 * and rounds the trailing partial year up to a full year once it exceeds
 * six months (the Act's settled "> 6 months counts as a full year" rule;
 * exactly 6 months does not round up). Never negative.
 */
export function completedYearsOfService(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const anniversaryThisYear = new Date(
    Date.UTC(to.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  if (to.getTime() < anniversaryThisYear.getTime()) years--;
  if (years < 0) return 0;

  // Six months (or more) past the latest completed anniversary rounds up.
  const lastAnniversary = new Date(
    Date.UTC(from.getUTCFullYear() + years, from.getUTCMonth(), from.getUTCDate()),
  );
  const sixMonthsAfter = new Date(
    Date.UTC(
      lastAnniversary.getUTCFullYear(),
      lastAnniversary.getUTCMonth() + 6,
      lastAnniversary.getUTCDate(),
    ),
  );
  if (to.getTime() > sixMonthsAfter.getTime()) years++;

  return years;
}

export interface GratuityInput {
  /** Full (unprorated) monthly Basic from the structure at separation. */
  lastDrawnBasic: Decimal | number | string;
  completedYears: number;
  eligibilityYears: number;
  daysPerYear: Decimal | number | string;
  monthDivisor: Decimal | number | string;
  /** Statutory max payable under the Act (₹20,00,000 per notification S.O. 1420(E)); tenant-editable, not a constant. */
  maxAmount: Decimal | number | string;
}

/**
 * Statutory gratuity formula (module 07 §12 decision 10): daysPerYear /
 * monthDivisor x lastDrawnBasic x completedYears, 0 below the eligibility
 * threshold, capped at `maxAmount`. Defaults are the common 15/26, 5-year
 * rule and the ₹20L statutory ceiling; all tenant-editable
 * (`PayrollSettings`), not constants.
 */
export function calculateGratuity(input: GratuityInput): Decimal {
  if (input.completedYears < input.eligibilityYears) return new D(0);
  const amount = new D(input.lastDrawnBasic)
    .times(input.daysPerYear)
    .div(input.monthDivisor)
    .times(input.completedYears)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return D.min(amount, new D(input.maxAmount));
}

export interface LeaveEncashmentInput {
  /** Leave's reported encashable balance (module 04's `getEncashableBalance()`). */
  encashableDays: Decimal | number | string;
  /** Sum of the configured `leaveEncashmentComponents`' monthly amounts. */
  componentsMonthlyTotal: Decimal | number | string;
  divisor: Decimal | number | string;
}

/** Per-day rate (componentsMonthlyTotal / divisor) x encashableDays — module 07 §12 decision 17. */
export function calculateLeaveEncashment(input: LeaveEncashmentInput): Decimal {
  const perDayRate = new D(input.componentsMonthlyTotal).div(input.divisor);
  return perDayRate.times(input.encashableDays).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
