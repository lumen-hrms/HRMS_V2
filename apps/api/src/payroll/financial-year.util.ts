/**
 * Indian financial year (April -> March) helpers for module 07 Phase 6's TDS
 * projection. `period` is always `YYYY-MM`, same format as the rest of
 * Payroll.
 */

/** "2026-04" -> "2026-27"; "2027-02" -> "2026-27". */
export function financialYear(period: string): string {
  const [yearStr, monthStr] = period.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** All 12 `YYYY-MM` periods of the FY `period` falls in, in chronological (April-first) order. */
export function financialYearPeriods(period: string): string[] {
  const [yearStr, monthStr] = period.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const startYear = month >= 4 ? year : year - 1;
  const periods: string[] = [];
  for (let i = 0; i < 12; i++) {
    const absoluteMonth = 4 + i; // 4..15, Apr of startYear through Mar of startYear+1
    const y = startYear + Math.floor((absoluteMonth - 1) / 12);
    const m = ((absoluteMonth - 1) % 12) + 1;
    periods.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return periods;
}

/** Months left in the FY, including `period` itself (April = 12, March = 1). */
export function monthsRemainingInFinancialYear(period: string): number {
  const periods = financialYearPeriods(period);
  return 12 - periods.indexOf(period);
}

/** The FY's periods strictly before `period`, chronological. Empty in April. */
export function elapsedPeriodsInFinancialYear(period: string): string[] {
  const periods = financialYearPeriods(period);
  return periods.slice(0, periods.indexOf(period));
}
