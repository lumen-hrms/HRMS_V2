export interface DayBreak {
  startAt: string;
  /** Null while the break is still going. */
  endAt: string | null;
}

export interface DayTimes {
  checkInAt: string | null;
  checkOutAt: string | null;
  breaks: DayBreak[];
}

/**
 * Where today stands at `now`: time worked (in minus breaks), time on breaks
 * and how many breaks. Same arithmetic as the API's `attendance.today()`, so
 * the ring can keep counting between refreshes — an unfinished day runs to
 * `now`, a finished one to check-out, and a break still open runs to the same.
 */
export function dayTotals(day: DayTimes, now: number) {
  if (!day.checkInAt) return { workedMs: 0, breakMs: 0, breakCount: 0 };
  const start = new Date(day.checkInAt).getTime();
  const end = day.checkOutAt ? new Date(day.checkOutAt).getTime() : now;
  const breakMs = day.breaks.reduce((sum, b) => {
    const from = new Date(b.startAt).getTime();
    const to = b.endAt ? new Date(b.endAt).getTime() : end;
    return sum + Math.max(Math.min(to, end) - from, 0);
  }, 0);
  return {
    workedMs: Math.max(end - start - breakMs, 0),
    breakMs,
    breakCount: day.breaks.length,
  };
}

/** "3h 10m" */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(Math.round(ms / 60000), 0);
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}
