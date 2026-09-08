/** Timestamps are stored UTC; the console displays IST. */

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${s} IST`;
}

/** "in 4 days" / "3 days ago" — coarse, for trial-ends / renewal chips. */
export function fmtUntil(iso: string | null | undefined): { text: string; days: number } | null {
  if (!iso) return null;
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { text: `${-days}d ago`, days };
  if (days === 0) return { text: 'today', days };
  return { text: `in ${days}d`, days };
}

/** mm:ss countdown for the break-glass TTL. */
export function fmtCountdown(msLeft: number): string {
  if (msLeft <= 0) return '0m 00s';
  const total = Math.floor(msLeft / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}
