/** The tenant-configurable leave/financial year a date falls in (e.g. with
 *  `fyStartMonth = 4`, 2027-02-01 belongs to leave year 2026). With
 *  `fyStartMonth = 1` this always equals the calendar year. */
export function resolveLeaveYear(date: Date, fyStartMonth: number): number {
  const month = date.getUTCMonth() + 1; // 1-12
  return month >= fyStartMonth ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}
