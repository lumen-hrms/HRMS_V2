import { normalizeHeader, toEnumKey, type ParsedSheet } from '../common/bulk-import';
import type { LeaveYearWindow } from './leave-entitlement';

/**
 * Holiday list import + validation (module 04), shared by company setup's
 * Holidays step and Leave › Holidays › Import. Pure — callers supply the
 * leave-year windows, weekly offs and payroll-locked months.
 *
 * Template: `date, name, type` — `type` is PUBLIC (default when blank) or
 * OPTIONAL (an optional/restricted holiday: a working day unless an employee
 * takes it as Restricted Holiday leave).
 */

export const HOLIDAY_IMPORT_COLUMNS = ['date', 'name', 'type'] as const;

export interface HolidayInput {
  /** 1-based spreadsheet row, when the holiday came from a file. */
  row?: number;
  date: string; // YYYY-MM-DD
  name: string;
  optional: boolean;
}

export interface HolidayIssue {
  level: 'error' | 'warning';
  row?: number;
  date?: string;
  message: string;
}

const OPTIONAL_TYPES = new Set(['OPTIONAL', 'RESTRICTED', 'RH', 'FLOATING']);
const PUBLIC_TYPES = new Set(['PUBLIC', 'NATIONAL', 'GAZETTED', 'COMPANY', 'MANDATORY', 'FIXED']);
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * `YYYY-MM-DD`, `DD-MM-YYYY` or `DD.MM.YYYY`. A slash date is accepted only
 * when it can't be misread — `26/01/2027` is unambiguous, but `03/04/2027`
 * is 3 April in India and 4 March in Excel's US default, so it's rejected
 * rather than guessed. XLSX date cells arrive as ISO already.
 */
export function parseHolidayDate(value: string): { date: string } | { error: string } {
  const v = value.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})[-.](\d{1,2})[-.](\d{4})$/.exec(v))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (d <= 12 && m <= 12 && d !== m) {
      return {
        error: `"${v}" is ambiguous (day/month or month/day?) — write it as DD-MM-YYYY or YYYY-MM-DD`,
      };
    }
  } else {
    return { error: `"${v}" is not a date — use DD-MM-YYYY or YYYY-MM-DD` };
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return { error: `"${v}" is not a real calendar date` };
  }
  return { date: date.toISOString().slice(0, 10) };
}

/** Reads a parsed holiday sheet into holidays + per-row parse errors. */
export function parseHolidaySheet(sheet: ParsedSheet): {
  holidays: HolidayInput[];
  issues: HolidayIssue[];
  ignoredColumns: string[];
} {
  const known = new Set(HOLIDAY_IMPORT_COLUMNS.map(normalizeHeader));
  const ignoredColumns = sheet.headers.filter((h) => !known.has(h));
  const holidays: HolidayInput[] = [];
  const issues: HolidayIssue[] = [];
  for (const r of sheet.rows) {
    const rawDate = r.values.get('date');
    const name = r.values.get('name')?.trim();
    const rawType = r.values.get('type');
    const errors: string[] = [];
    let date: string | undefined;
    if (!rawDate) errors.push('date is required');
    else {
      const parsed = parseHolidayDate(rawDate);
      if ('error' in parsed) errors.push(parsed.error);
      else date = parsed.date;
    }
    if (!name) errors.push('name is required');
    let optional = false;
    if (rawType) {
      const t = toEnumKey(rawType);
      if (OPTIONAL_TYPES.has(t)) optional = true;
      else if (!PUBLIC_TYPES.has(t)) errors.push(`type "${rawType}" must be PUBLIC or OPTIONAL`);
    }
    if (errors.length > 0) {
      errors.forEach((message) => issues.push({ level: 'error', row: r.row, message }));
    } else {
      holidays.push({ row: r.row, date: date!, name: name!, optional });
    }
  }
  return { holidays, issues, ignoredColumns };
}

export interface HolidayValidationContext {
  /** The leave year in progress and the next one — the only range a holiday may fall in. */
  current: LeaveYearWindow;
  next: LeaveYearWindow;
  weeklyOffDays: number[];
  /** `YYYY-MM` months whose payroll is already processed/disbursed. */
  lockedMonths: Set<string>;
  /** `date|name` keys already saved — a locked month only blocks *new* holidays. */
  existingKeys?: Set<string>;
}

export const holidayKey = (h: { date: string; name: string }) =>
  `${h.date}|${h.name.trim().toLowerCase()}`;

/** Every rule a holiday list must pass before it's saved. */
export function validateHolidays(
  holidays: HolidayInput[],
  ctx: HolidayValidationContext,
): HolidayIssue[] {
  const issues: HolidayIssue[] = [];
  const at = (h: HolidayInput) => (h.row ? { row: h.row } : {});
  const seen = new Map<string, HolidayInput>();
  const namesByDate = new Map<string, string[]>();
  const minDate = ctx.current.start.toISOString().slice(0, 10);
  const maxDateExclusive = ctx.next.end.toISOString().slice(0, 10);

  for (const h of holidays) {
    const k = holidayKey(h);
    if (seen.has(k)) {
      const first = seen.get(k)!;
      issues.push({
        level: 'error',
        ...at(h),
        date: h.date,
        message: `"${h.name}" on ${h.date} is listed twice${first.row ? ` (first on row ${first.row})` : ''}`,
      });
      continue;
    }
    seen.set(k, h);

    if (h.date < minDate || h.date >= maxDateExclusive) {
      issues.push({
        level: 'error',
        ...at(h),
        date: h.date,
        message: `${h.date} is outside leave years ${ctx.current.year} and ${ctx.next.year} (${minDate} to before ${maxDateExclusive})`,
      });
      continue;
    }
    if (ctx.lockedMonths.has(h.date.slice(0, 7)) && !ctx.existingKeys?.has(k)) {
      issues.push({
        level: 'error',
        ...at(h),
        date: h.date,
        message: `Payroll for ${h.date.slice(0, 7)} is already processed — a holiday can't be added to a paid month`,
      });
      continue;
    }
    const weekday = new Date(`${h.date}T00:00:00Z`).getUTCDay();
    if (ctx.weeklyOffDays.includes(weekday)) {
      issues.push({
        level: 'warning',
        ...at(h),
        date: h.date,
        message: `"${h.name}" falls on a ${DAY_NAMES[weekday]} (a weekly off) — it has no effect`,
      });
    }
    namesByDate.set(h.date, [...(namesByDate.get(h.date) ?? []), h.name]);
  }

  for (const [date, names] of namesByDate) {
    if (names.length > 1) {
      issues.push({
        level: 'warning',
        date,
        message: `${names.length} holidays on ${date} (${names.join(', ')}) — counted as one day off`,
      });
    }
  }

  // A list that stops well before the year ends is usually a half-filled file.
  const currentDates = [...seen.values()]
    .map((h) => h.date)
    .filter((d) => d >= minDate && d < ctx.current.end.toISOString().slice(0, 10))
    .sort();
  const lastQuarterStart = new Date(
    Date.UTC(ctx.current.end.getUTCFullYear(), ctx.current.end.getUTCMonth() - 3, 1),
  )
    .toISOString()
    .slice(0, 10);
  if (currentDates.length > 0 && currentDates[currentDates.length - 1] < lastQuarterStart) {
    issues.push({
      level: 'warning',
      message: `No holidays after ${currentDates[currentDates.length - 1]} in leave year ${ctx.current.year} — is the list complete?`,
    });
  }
  return issues;
}
