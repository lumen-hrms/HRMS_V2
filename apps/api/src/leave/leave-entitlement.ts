/**
 * Pure leave-entitlement math (module 04) — no DB access, so every edge case
 * (mid-year go-live, mid-year joiner, future joiner, imported opening
 * balance, year-end carry-forward) is unit-testable on its own. The DB side
 * lives in `leave-entitlement.service.ts`; the daily accrual job, a newly
 * created employee and company setup's submit all go through it.
 *
 * Rules (docs/modules/04_LEAVE_MANAGEMENT.md "Entitlement"):
 * - Nothing is ever credited before the employee's *effective start*: the
 *   latest of the leave-year start, their date of joining and the tenant's
 *   go-live date.
 * - Part-period credits are whole days (owner decision — no decimals): the
 *   prorated share is rounded to the nearest day, half up. With 2 days a
 *   month that's 2 from the 1st, 1 from mid-month, 0 for the last few days.
 *   Full periods are never rounded, so a 15-day monthly type still adds up
 *   to 15 over the year.
 * - ANNUAL types: one grant per leave year, prorated by the share of the year
 *   left after the effective start (whole days). An
 *   employee with an imported opening balance for the type gets no grant —
 *   the opening balance already is this year's entitlement.
 * - MONTHLY / QUARTERLY types: one credit per period, at the start of the
 *   period, the first one prorated by days if the effective start falls
 *   inside it. Periods are aligned to the leave year (quarters of an April
 *   year start in Apr/Jul/Oct/Jan). A period already holding an ACCRUAL
 *   ledger entry is never credited again, which makes every caller
 *   idempotent.
 * - Accrual credits in a year never exceed the type's annual quota.
 *   Carried-forward and opening-balance days sit outside that cap.
 */

export type AccrualFrequencyKey = 'ANNUAL' | 'MONTHLY' | 'QUARTERLY';

/** Half-open `[start, end)` leave year. */
export interface LeaveYearWindow {
  year: number;
  start: Date;
  end: Date;
}

export interface Period {
  start: Date;
  end: Date;
}

export interface Credit {
  /** Start of the period this credit belongs to (the leave-year start for ANNUAL). */
  periodStart: Date;
  /** When the ledger entry is dated: the period start, or the effective start for a partial first period. */
  occurredAt: Date;
  amount: number;
}

const DAY_MS = 86_400_000;

export function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function leaveYearWindow(year: number, fyStartMonth: number): LeaveYearWindow {
  return {
    year,
    start: new Date(Date.UTC(year, fyStartMonth - 1, 1)),
    end: new Date(Date.UTC(year + 1, fyStartMonth - 1, 1)),
  };
}

/** Periods of a leave year for a periodic accrual frequency. */
export function accrualPeriods(
  frequency: 'MONTHLY' | 'QUARTERLY',
  window: LeaveYearWindow,
): Period[] {
  const step = frequency === 'MONTHLY' ? 1 : 3;
  const periods: Period[] = [];
  for (let i = 0; i < 12; i += step) {
    const start = new Date(
      Date.UTC(window.start.getUTCFullYear(), window.start.getUTCMonth() + i, 1),
    );
    const end = new Date(
      Date.UTC(window.start.getUTCFullYear(), window.start.getUTCMonth() + i + step, 1),
    );
    periods.push({ start, end });
  }
  return periods;
}

/** The period of `window` that `date` falls in (the year itself for ANNUAL). */
export function periodContaining(
  frequency: AccrualFrequencyKey,
  window: LeaveYearWindow,
  date: Date,
): Period | null {
  if (date < window.start || date >= window.end) return null;
  if (frequency === 'ANNUAL') return { start: window.start, end: window.end };
  return accrualPeriods(frequency, window).find((p) => date >= p.start && date < p.end) ?? null;
}

/** Latest of the leave-year start, the date of joining and go-live. */
export function effectiveStart(
  window: LeaveYearWindow,
  dateOfJoining: Date | null,
  goLiveDate: Date | null,
): Date {
  let start = window.start;
  for (const d of [dateOfJoining, goLiveDate]) {
    if (d && utcDay(d) > start) start = utcDay(d);
  }
  return start;
}

export const roundHalf = (n: number) => Math.round(n * 2) / 2;
/** Nearest whole day, half up — how every part-period credit is rounded. */
export const wholeDays = (n: number) => Math.round(n);
export const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CreditInput {
  accrualFrequency: AccrualFrequencyKey;
  annualQuota: number;
  window: LeaveYearWindow;
  effectiveStart: Date;
  /** Today (UTC day). Nothing dated after it is credited yet. */
  today: Date;
  /** Start times (ms) of periods that already hold an ACCRUAL ledger entry. */
  creditedPeriodStarts: Set<number>;
  /** Sum of this year's ACCRUAL ledger deltas so far. */
  accruedSoFar: number;
  /** An imported opening balance exists for this employee/type/year. */
  hasOpeningBalance: boolean;
}

/** Credits still owed to one employee for one leave type in one leave year. */
export function creditsDue(input: CreditInput): Credit[] {
  const { window, today, annualQuota } = input;
  const start = input.effectiveStart;
  if (annualQuota <= 0 || start >= window.end || start > today) return [];
  let remaining = round2(annualQuota - input.accruedSoFar);
  if (remaining <= 0) return [];

  if (input.accrualFrequency === 'ANNUAL') {
    if (input.hasOpeningBalance || input.creditedPeriodStarts.size > 0) return [];
    const share =
      (window.end.getTime() - start.getTime()) / (window.end.getTime() - window.start.getTime());
    const amount = Math.min(share >= 1 ? annualQuota : wholeDays(annualQuota * share), remaining);
    return amount > 0 ? [{ periodStart: window.start, occurredAt: start, amount }] : [];
  }

  const periods = accrualPeriods(input.accrualFrequency, window);
  const perPeriod = annualQuota / periods.length;
  const credits: Credit[] = [];
  for (const p of periods) {
    if (p.start > today) break;
    if (p.end <= start) continue;
    if (input.creditedPeriodStarts.has(p.start.getTime())) continue;
    const partial = start > p.start;
    const fraction = partial
      ? (p.end.getTime() - start.getTime()) / (p.end.getTime() - p.start.getTime())
      : 1;
    const amount = Math.min(
      partial ? wholeDays(perPeriod * fraction) : round2(perPeriod),
      remaining,
    );
    // A last-few-days start rounds to 0: nothing for that period, but keep
    // going — the next full period is still owed.
    if (amount <= 0) continue;
    credits.push({ periodStart: p.start, occurredAt: partial ? start : p.start, amount });
    remaining = round2(remaining - amount);
  }
  return credits;
}

/** Days rolled into the new leave year: unused balance, capped by the type's carry-forward cap. */
export function carryForwardDays(previousAvailable: number, carryForwardCap: number): number {
  if (carryForwardCap <= 0 || previousAvailable <= 0) return 0;
  return round2(Math.min(previousAvailable, carryForwardCap));
}

/** Whole days from `a` to `b` (UTC days). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((utcDay(b).getTime() - utcDay(a).getTime()) / DAY_MS);
}
