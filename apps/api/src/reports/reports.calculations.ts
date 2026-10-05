/**
 * Pure calculations behind Reports & Analytics. No Prisma, no Nest — the
 * service loads employee snapshots and hands them here, so every number on
 * screen is unit-testable without a database.
 *
 * Day model: all dates are UTC calendar days. An employee counts toward
 * headcount at an instant when they have joined by that instant and have not
 * yet left (a `lastWorkingDate` of day D means they are gone at the end of D).
 */

export const DAY_MS = 86_400_000;
export const MAX_RANGE_MONTHS = 60;
export const DEFAULT_RANGE_MONTHS = 12;
export const UNSPECIFIED = 'UNSPECIFIED';

export interface EmployeeSnapshot {
  departmentName: string | null;
  employmentType: string | null;
  dateOfJoining: Date | null;
  lastWorkingDate: Date | null;
  separationReason: string | null;
}

export interface MonthBucket {
  key: string; // YYYY-MM
  start: Date; // first day of the bucket (clipped to the period), UTC midnight
  end: Date; // last instant of the bucket (end of day)
  openingInstant: Date; // end of the day before `start`
}

export function endOfDay(day: Date): Date {
  return new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59, 59, 999),
  );
}

export function addDays(day: Date, days: number): Date {
  return new Date(day.getTime() + days * DAY_MS);
}

export function toIsoDay(day: Date): string {
  return day.toISOString().slice(0, 10);
}

export function isActiveAt(e: EmployeeSnapshot, instant: Date): boolean {
  return (
    e.dateOfJoining !== null &&
    e.dateOfJoining.getTime() <= instant.getTime() &&
    (e.lastWorkingDate === null || e.lastWorkingDate.getTime() > instant.getTime())
  );
}

export function leftWithin(e: EmployeeSnapshot, start: Date, end: Date): boolean {
  return (
    e.lastWorkingDate !== null &&
    e.lastWorkingDate.getTime() >= start.getTime() &&
    e.lastWorkingDate.getTime() <= end.getTime()
  );
}

export function joinedWithin(e: EmployeeSnapshot, start: Date, end: Date): boolean {
  return (
    e.dateOfJoining !== null &&
    e.dateOfJoining.getTime() >= start.getTime() &&
    e.dateOfJoining.getTime() <= end.getTime()
  );
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Parses a strict `YYYY-MM-DD` into UTC midnight; null if malformed or not a real date. */
export function parseIsoDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || toIsoDay(d) !== value ? null : d;
}

/**
 * Resolves the requested window. Defaults: `to` = today, `from` = the first
 * day of the month `DEFAULT_RANGE_MONTHS - 1` months before `to`'s month
 * (so the default is 12 whole calendar months ending this month).
 */
export function resolvePeriod(
  input: { from?: string; to?: string },
  today: Date,
): { from: Date; to: Date; months: number } {
  const todayDay = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const to = input.to ? parseIsoDay(input.to) : todayDay;
  if (!to) throw new Error('to must be a valid YYYY-MM-DD date');
  const from = input.from
    ? parseIsoDay(input.from)
    : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - (DEFAULT_RANGE_MONTHS - 1), 1));
  if (!from) throw new Error('from must be a valid YYYY-MM-DD date');
  if (from.getTime() > to.getTime()) throw new Error('from must be on or before to');
  const months = monthBuckets(from, to).length;
  if (months > MAX_RANGE_MONTHS) {
    throw new Error(`Range may not exceed ${MAX_RANGE_MONTHS} months`);
  }
  return { from, to, months };
}

export function monthBuckets(from: Date, to: Date): MonthBucket[] {
  const buckets: MonthBucket[] = [];
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth();
  for (;;) {
    const monthStart = new Date(Date.UTC(year, month, 1));
    if (monthStart.getTime() > to.getTime()) break;
    const nextMonthStart = new Date(Date.UTC(year, month + 1, 1));
    const start = monthStart.getTime() < from.getTime() ? from : monthStart;
    const lastDay = new Date(Math.min(nextMonthStart.getTime() - DAY_MS, to.getTime()));
    buckets.push({
      key: `${year}-${String(month + 1).padStart(2, '0')}`,
      start,
      end: endOfDay(lastDay),
      openingInstant: endOfDay(addDays(start, -1)),
    });
    month += 1;
    if (month === 12) {
      month = 0;
      year += 1;
    }
  }
  return buckets;
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function sortedBreakdown(counts: Record<string, number>, labelKey: string) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ [labelKey]: name, count }));
}

// ---------------------------------------------------------------------------
// FR-RPT-001 — headcount at a point in time
// ---------------------------------------------------------------------------

export function computeHeadcount(employees: EmployeeSnapshot[], asOf: Date) {
  const active = employees.filter((e) => isActiveAt(e, endOfDay(asOf)));
  const byDepartment = sortedBreakdown(
    countBy(active, (e) => e.departmentName ?? 'Unassigned'),
    'name',
  );
  const byEmploymentType = sortedBreakdown(
    countBy(active, (e) => e.employmentType ?? UNSPECIFIED),
    'type',
  );
  const headcount = active.length;
  return {
    summary: {
      asOf: toIsoDay(asOf),
      headcount,
      byDepartment,
      byEmploymentType,
      // Joining date is required to place someone in time; without it they
      // can't be counted at any date, so surface the gap instead of hiding it.
      missingJoiningDate: employees.filter((e) => e.dateOfJoining === null).length,
    },
    table: {
      columns: [
        { key: 'department', label: 'Department' },
        { key: 'headcount', label: 'Headcount' },
        { key: 'sharePct', label: 'Share %' },
      ],
      rows: byDepartment.map((d) => ({
        department: d.name,
        headcount: d.count,
        sharePct: headcount === 0 ? 0 : round2((d.count / headcount) * 100),
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Monthly joiners / leavers and net movement
// ---------------------------------------------------------------------------

export function computeMovement(employees: EmployeeSnapshot[], from: Date, to: Date) {
  const months = monthBuckets(from, to).map((b) => {
    const opening = employees.filter((e) => isActiveAt(e, b.openingInstant)).length;
    const closing = employees.filter((e) => isActiveAt(e, b.end)).length;
    const joiners = employees.filter((e) => joinedWithin(e, b.start, b.end)).length;
    const leavers = employees.filter((e) => leftWithin(e, b.start, b.end)).length;
    return { month: b.key, opening, joiners, leavers, closing };
  });
  const totalJoiners = months.reduce((s, m) => s + m.joiners, 0);
  const totalLeavers = months.reduce((s, m) => s + m.leavers, 0);
  return {
    summary: {
      from: toIsoDay(from),
      to: toIsoDay(to),
      openingHeadcount: months[0]?.opening ?? 0,
      closingHeadcount: months[months.length - 1]?.closing ?? 0,
      joiners: totalJoiners,
      leavers: totalLeavers,
      netChange: totalJoiners - totalLeavers,
    },
    table: {
      columns: [
        { key: 'month', label: 'Month' },
        { key: 'opening', label: 'Opening' },
        { key: 'joiners', label: 'Joiners' },
        { key: 'leavers', label: 'Leavers' },
        { key: 'closing', label: 'Closing' },
      ],
      rows: months,
    },
  };
}

// ---------------------------------------------------------------------------
// FR-RPT-003 — attrition: rate, tenure, voluntary vs involuntary
// ---------------------------------------------------------------------------

const DAYS_PER_MONTH = 30.4375;

function averageOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((s, v) => s + v, 0) / values.length);
}

export function computeAttrition(employees: EmployeeSnapshot[], from: Date, to: Date) {
  const buckets = monthBuckets(from, to);
  const monthRows = buckets.map((b) => {
    const opening = employees.filter((e) => isActiveAt(e, b.openingInstant)).length;
    const closing = employees.filter((e) => isActiveAt(e, b.end)).length;
    const averageHeadcount = (opening + closing) / 2;
    const leavers = employees.filter((e) => leftWithin(e, b.start, b.end));
    const split = countBy(leavers, (e) => e.separationReason ?? UNSPECIFIED);
    return {
      month: b.key,
      averageHeadcount: round2(averageHeadcount),
      leavers: leavers.length,
      voluntary: split.VOLUNTARY ?? 0,
      involuntary: split.INVOLUNTARY ?? 0,
      other: split.OTHER ?? 0,
      unspecified: split[UNSPECIFIED] ?? 0,
      monthlyRatePct:
        averageHeadcount === 0 ? 0 : round2((leavers.length / averageHeadcount) * 100),
    };
  });

  const leavers = employees.filter((e) => leftWithin(e, from, endOfDay(to)));
  const openingHeadcount = employees.filter((e) =>
    isActiveAt(e, endOfDay(addDays(from, -1))),
  ).length;
  const closingHeadcount = employees.filter((e) => isActiveAt(e, endOfDay(to))).length;
  const averageHeadcount = averageOrNull(monthRows.map((m) => m.averageHeadcount)) ?? 0;
  const periodRatePct =
    averageHeadcount === 0 ? 0 : round2((leavers.length / averageHeadcount) * 100);
  const split = countBy(leavers, (e) => e.separationReason ?? UNSPECIFIED);

  const leaverTenureMonths = leavers
    .filter((e) => e.dateOfJoining !== null && e.lastWorkingDate !== null)
    .map(
      (e) => (e.lastWorkingDate!.getTime() - e.dateOfJoining!.getTime()) / DAY_MS / DAYS_PER_MONTH,
    );
  const activeTenureMonths = employees
    .filter((e) => isActiveAt(e, endOfDay(to)))
    .map((e) => (endOfDay(to).getTime() - e.dateOfJoining!.getTime()) / DAY_MS / DAYS_PER_MONTH);

  return {
    summary: {
      from: toIsoDay(from),
      to: toIsoDay(to),
      months: buckets.length,
      openingHeadcount,
      closingHeadcount,
      averageHeadcount,
      leavers: leavers.length,
      voluntary: split.VOLUNTARY ?? 0,
      involuntary: split.INVOLUNTARY ?? 0,
      other: split.OTHER ?? 0,
      unspecified: split[UNSPECIFIED] ?? 0,
      periodRatePct,
      annualisedRatePct: round2(periodRatePct * (12 / Math.max(buckets.length, 1))),
      avgLeaverTenureMonths: averageOrNull(leaverTenureMonths),
      avgActiveTenureMonths: averageOrNull(activeTenureMonths),
    },
    table: {
      columns: [
        { key: 'month', label: 'Month' },
        { key: 'averageHeadcount', label: 'Average headcount' },
        { key: 'leavers', label: 'Leavers' },
        { key: 'voluntary', label: 'Voluntary' },
        { key: 'involuntary', label: 'Involuntary' },
        { key: 'other', label: 'Other' },
        { key: 'unspecified', label: 'Unspecified' },
        { key: 'monthlyRatePct', label: 'Monthly rate %' },
      ],
      rows: monthRows,
    },
  };
}
