/**
 * Working-day math for payroll proration (decision 4, decision 14).
 * Mirrors `countWorkingDays` in `leave/leave.service.ts` — each module owns
 * its own copy rather than sharing one, per the modular-monolith boundary.
 */

/** `period` is `YYYY-MM`. `start`/`end` are half-open: `[start, end)`. */
export function monthRange(period: string): { start: Date; end: Date } {
  const [y, m] = period.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start, end };
}

/** Inclusive of start/end, excluding holidays and weekly-offs. */
export function countWorkingDays(
  start: Date,
  end: Date,
  holidayDates: Set<string>,
  weeklyOffDays: number[],
): number {
  let count = 0;
  const cur = new Date(start);
  while (cur.getTime() <= end.getTime()) {
    const iso = cur.toISOString().slice(0, 10);
    if (!holidayDates.has(iso) && !weeklyOffDays.includes(cur.getUTCDay())) {
      count++;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

/**
 * An employee's effective weekly off-days: their override if set, else the
 * tenant default (decision 14). `override` is `undefined`/`null`/`[]` →
 * falls back (an employee can't have zero off-days by clearing the array;
 * that's not a case this module needs to support).
 */
export function effectiveWeeklyOffDays(
  tenantWeeklyOffDays: number[],
  employeeOverride: number[] | null | undefined,
): number[] {
  return employeeOverride && employeeOverride.length > 0 ? employeeOverride : tenantWeeklyOffDays;
}

/**
 * Payable days for one employee in one period: working days in the
 * sub-range they were actually employed (default: the whole period), minus
 * whole-day LOP (decision 3, decision 15 — half-day leave is never LOP, so
 * this is always a whole number in V1).
 */
export function computePayableDays(
  periodStart: Date,
  periodEnd: Date,
  holidayDates: Set<string>,
  weeklyOffDays: number[],
  lopDays: number,
  employedFrom?: Date,
  employedTo?: Date,
): { workingDays: number; payableDays: number } {
  const workingDays = countWorkingDays(periodStart, periodEnd, holidayDates, weeklyOffDays);

  const rangeStart = employedFrom && employedFrom > periodStart ? employedFrom : periodStart;
  const rangeEnd = employedTo && employedTo < periodEnd ? employedTo : periodEnd;
  const employedWorkingDays =
    rangeStart > rangeEnd ? 0 : countWorkingDays(rangeStart, rangeEnd, holidayDates, weeklyOffDays);

  const payableDays = Math.max(0, employedWorkingDays - lopDays);
  return { workingDays, payableDays };
}
