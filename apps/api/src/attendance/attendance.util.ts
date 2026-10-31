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

/** One day of a month's attendance, shaped for the dashboard charts. */
export interface DailyAttendance {
  /** YYYY-MM-DD */
  date: string;
  status: string;
  /** Minutes since midnight IST, or null when there is no punch. */
  checkInMinutes: number | null;
  checkOutMinutes: number | null;
  /** Time worked net of breaks — null until the day is complete (checked out). */
  workedMinutes: number | null;
  breakMinutes: number;
}

const IST_OFFSET_MINUTES = 330;
const minutesOfDayIst = (d: Date) =>
  (d.getUTCHours() * 60 + d.getUTCMinutes() + IST_OFFSET_MINUTES) % 1440;

/**
 * A month's attendance records as a per-day series (oldest first). Worked
 * time uses the same arithmetic as `sumOvertimeHours`: gross minus breaks,
 * an unfinished break counting up to check-out.
 */
export function dailySeries(
  records: Array<{
    date: Date;
    status: string;
    checkInAt: Date | null;
    checkOutAt: Date | null;
    breaks: Array<{ startAt: Date; endAt: Date | null }>;
  }>,
): DailyAttendance[] {
  return [...records]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((r) => {
      const breakMs = r.checkInAt
        ? r.breaks.reduce((sum, b) => {
            const end = b.endAt ?? r.checkOutAt;
            return end ? sum + Math.max(end.getTime() - b.startAt.getTime(), 0) : sum;
          }, 0)
        : 0;
      const workedMs =
        r.checkInAt && r.checkOutAt
          ? Math.max(r.checkOutAt.getTime() - r.checkInAt.getTime() - breakMs, 0)
          : null;
      return {
        date: r.date.toISOString().slice(0, 10),
        status: r.status,
        checkInMinutes: r.checkInAt ? minutesOfDayIst(r.checkInAt) : null,
        checkOutMinutes: r.checkOutAt ? minutesOfDayIst(r.checkOutAt) : null,
        workedMinutes: workedMs === null ? null : Math.round(workedMs / 60000),
        breakMinutes: Math.round(breakMs / 60000),
      };
    });
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
