/**
 * Pure calculations behind the admin dashboard's "workforce" panels: headcount
 * and its trend, status split, joiners, birthdays and anniversaries, people on
 * notice, and data-hygiene gaps. Everything is derived from one list of
 * employees; the service supplies it (and the clock) so this stays testable.
 */

export interface InsightEmployee {
  id: string;
  firstName: string;
  lastName: string;
  designation: string | null;
  departmentId: string | null;
  department: { name: string } | null;
  dateOfBirth: Date | null;
  dateOfJoining: Date | null;
  lifecycleState: string;
  lastWorkingDate: Date | null;
}

/** People who are actually working: not yet to join, and not gone. */
const ACTIVE = new Set(['PROBATION', 'CONFIRMED', 'NOTICE_PERIOD', 'SUSPENDED']);
const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;

const fullName = (e: Pick<InsightEmployee, 'firstName' | 'lastName'>) =>
  `${e.firstName} ${e.lastName}`.trim();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / DAY_MS);

/** The next calendar occurrence (today counts) of a yearly date; 29 Feb falls back to 28 Feb off leap years. */
export function nextOccurrence(date: Date, today: Date): Date {
  const month = date.getUTCMonth();
  const at = (year: number) => {
    const d = new Date(Date.UTC(year, month, date.getUTCDate()));
    return d.getUTCMonth() === month ? d : new Date(Date.UTC(year, month, 28));
  };
  const thisYear = at(today.getUTCFullYear());
  return thisYear >= today ? thisYear : at(today.getUTCFullYear() + 1);
}

export interface PersonRef {
  id: string;
  name: string;
  designation: string | null;
  department: string | null;
}

const ref = (e: InsightEmployee): PersonRef => ({
  id: e.id,
  name: fullName(e),
  designation: e.designation,
  department: e.department?.name ?? null,
});

export function computeWorkforceInsights(employees: InsightEmployee[], today: Date) {
  const active = employees.filter((e) => ACTIVE.has(e.lifecycleState));

  const count = (state: string) => employees.filter((e) => e.lifecycleState === state).length;
  const status = {
    probation: count('PROBATION'),
    confirmed: count('CONFIRMED'),
    noticePeriod: count('NOTICE_PERIOD'),
    suspended: count('SUSPENDED'),
    preJoining: count('PRE_JOINING'),
    separated: count('SEPARATED'),
  };

  // Active people per department, biggest first.
  const byDept = new Map<string, { id: string; name: string; count: number }>();
  for (const e of active) {
    if (!e.departmentId || !e.department) continue;
    const row = byDept.get(e.departmentId) ?? {
      id: e.departmentId,
      name: e.department.name,
      count: 0,
    };
    row.count++;
    byDept.set(e.departmentId, row);
  }
  const departments = [...byDept.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );

  // Headcount at the end of each of the last six months (this month: up to today).
  const headcountTrend = Array.from({ length: 6 }, (_, i) => {
    const offset = 5 - i;
    const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - offset, 1));
    const monthEnd = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    const cutoff = monthEnd > today ? today : monthEnd;
    const n = employees.filter(
      (e) =>
        e.dateOfJoining &&
        e.dateOfJoining <= cutoff &&
        (e.lifecycleState !== 'SEPARATED' ||
          (e.lastWorkingDate !== null && e.lastWorkingDate > cutoff)),
    ).length;
    return { month: iso(first).slice(0, 7), count: n };
  });

  const windowStart = new Date(today.getTime() - WINDOW_DAYS * DAY_MS);
  const joinedRecently = active
    .filter((e) => e.dateOfJoining && e.dateOfJoining > windowStart && e.dateOfJoining <= today)
    .sort((a, b) => b.dateOfJoining!.getTime() - a.dateOfJoining!.getTime());
  const joiningSoon = employees.filter(
    (e) => e.lifecycleState === 'PRE_JOINING' && e.dateOfJoining && e.dateOfJoining > today,
  ).length;

  const upcoming = (pick: (e: InsightEmployee) => Date | null) =>
    active
      .flatMap((e) => {
        const base = pick(e);
        if (!base) return [];
        const when = nextOccurrence(base, today);
        const daysUntil = daysBetween(today, when);
        return daysUntil <= WINDOW_DAYS ? [{ e, base, when, daysUntil }] : [];
      })
      .sort((a, b) => a.daysUntil - b.daysUntil || fullName(a.e).localeCompare(fullName(b.e)));

  const upcomingBirthdays = upcoming((e) => e.dateOfBirth)
    .slice(0, 6)
    .map(({ e, when, daysUntil }) => ({ ...ref(e), date: iso(when), daysUntil }));
  const upcomingAnniversaries = upcoming((e) => e.dateOfJoining)
    .map((x) => ({ ...x, years: x.when.getUTCFullYear() - x.base.getUTCFullYear() }))
    .filter((x) => x.years >= 1)
    .slice(0, 6)
    .map(({ e, when, daysUntil, years }) => ({ ...ref(e), date: iso(when), daysUntil, years }));

  const exiting = employees
    .filter((e) => e.lifecycleState === 'NOTICE_PERIOD')
    .sort(
      (a, b) =>
        (a.lastWorkingDate?.getTime() ?? Infinity) - (b.lastWorkingDate?.getTime() ?? Infinity) ||
        fullName(a).localeCompare(fullName(b)),
    )
    .slice(0, 5)
    .map((e) => ({
      ...ref(e),
      lastWorkingDate: e.lastWorkingDate ? iso(e.lastWorkingDate) : null,
    }));

  return {
    activeHeadcount: active.length,
    status,
    departments,
    headcountTrend,
    joinedLast30Days: joinedRecently.length,
    joiningSoon,
    recentJoiners: joinedRecently
      .slice(0, 5)
      .map((e) => ({ ...ref(e), dateOfJoining: iso(e.dateOfJoining!) })),
    upcomingBirthdays,
    upcomingAnniversaries,
    exiting,
    needsAttention: {
      noDepartment: active.filter((e) => !e.departmentId).length,
      noJoiningDate: active.filter((e) => !e.dateOfJoining).length,
    },
  };
}
