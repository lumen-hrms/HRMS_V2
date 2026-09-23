/** Midnight UTC for "today" — a deliberate simplification for MVP scope
 * (matches the DATE column, no per-tenant timezone config yet). Swap for
 * a tenant-timezone-aware calendar day once that data exists. */
export function todayDateOnly(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function dateOnly(iso: string | Date): Date {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start, end };
}

export function monthBoundsOf(d: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return { start, end };
}

/** Shared by `AttendanceService.clockIn` and `AttendanceFinalizationProcessor`
 *  so "late" means the same thing whether a human clocked in or the nightly
 *  job derived it from punches. */
export function isLateCheckIn(
  checkInAt: Date,
  shift: { startTime: string; graceMinutes: number },
): boolean {
  const [hour, minute] = shift.startTime.split(':').map(Number);
  const graceEnd = new Date(checkInAt);
  graceEnd.setUTCHours(hour, minute + shift.graceMinutes, 0, 0);
  return checkInAt > graceEnd;
}

/** The status a day defaults to before considering any check-in/punch —
 *  holiday, then weekly-off, then (if neither) a genuine unexplained
 *  absence. Used by the nightly finalization job and by rejecting a
 *  regularization request (the day "stands as it was"). */
export function baseStatusFor(
  date: Date,
  holiday: unknown,
  weeklyOffDays: number[],
): 'HOLIDAY' | 'WEEKLY_OFF' | 'ABSENT' {
  if (holiday) return 'HOLIDAY';
  if (weeklyOffDays.includes(date.getUTCDay())) return 'WEEKLY_OFF';
  return 'ABSENT';
}
