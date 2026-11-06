/** Date helpers for the detail pages — all in UTC, like the day keys the API sends. */

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-10" for the month containing `d`. */
export const monthKey = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;

export const currentMonth = () => monthKey(new Date());

/** The month `delta` months from `key` (negative = earlier). */
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(Date.UTC(y, m - 1 + delta, 1)));
}

export function daysInMonth(key: string): number {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Every day key of the month, in order: ["2026-10-01", …]. */
export function monthDays(key: string): string[] {
  return Array.from({ length: daysInMonth(key) }, (_, i) => `${key}-${pad(i + 1)}`);
}

const utc = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

/** "October 2026" */
export const monthTitle = (key: string) =>
  utc(`${key}-01`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "Oct" */
export const monthShort = (key: string) =>
  utc(`${key}-01`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });

/** "Mon 5 Oct" */
export const dayLabel = (iso: string) =>
  utc(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "5 Oct" */
export const shortDate = (iso: string) =>
  utc(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "5" — the day of the month, for a crowded x axis. */
export const dayOfMonth = (iso: string) => String(utc(iso).getUTCDate());

/** "09:05 am" in the viewer's clock from an ISO timestamp. */
export const timeOf = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—';
