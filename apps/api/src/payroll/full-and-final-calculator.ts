import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/**
 * Completed full years between two UTC dates, calendar-anniversary based
 * (not a raw ms/365.25 division) — module 07 Phase 8 gratuity eligibility.
 * Never negative.
 */
export function completedYearsOfService(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const anniversaryThisYear = new Date(
    Date.UTC(to.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  if (to.getTime() < anniversaryThisYear.getTime()) years--;
  return Math.max(0, years);
}

export interface GratuityInput {
  /** Full (unprorated) monthly Basic from the structure at separation. */
  lastDrawnBasic: Decimal | number | string;
  completedYears: number;
  eligibilityYears: number;
  daysPerYear: Decimal | number | string;
  monthDivisor: Decimal | number | string;
}

/**
 * Statutory gratuity formula (module 07 §12 decision 10): daysPerYear /
 * monthDivisor x lastDrawnBasic x completedYears, 0 below the eligibility
 * threshold. Defaults are the common 15/26, 5-year rule; both tenant-
 * editable (`PayrollSettings`), not constants.
 */
export function calculateGratuity(input: GratuityInput): Decimal {
  if (input.completedYears < input.eligibilityYears) return new D(0);
  return new D(input.lastDrawnBasic)
    .times(input.daysPerYear)
    .div(input.monthDivisor)
    .times(input.completedYears)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
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
