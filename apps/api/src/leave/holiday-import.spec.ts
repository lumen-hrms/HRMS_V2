import { parseHolidayDate, parseHolidaySheet, validateHolidays } from './holiday-import';
import { leaveYearWindow } from './leave-entitlement';

const sheet = (rows: Record<string, string>[]) => ({
  headers: ['date', 'name', 'type'],
  rows: rows.map((values, i) => ({ row: i + 2, values: new Map(Object.entries(values)) })),
});

const ctx = (overrides = {}) => ({
  current: leaveYearWindow(2026, 4),
  next: leaveYearWindow(2027, 4),
  weeklyOffDays: [0, 6],
  lockedMonths: new Set<string>(),
  ...overrides,
});

describe('parseHolidayDate', () => {
  it('accepts ISO and DD-MM-YYYY / DD.MM.YYYY', () => {
    expect(parseHolidayDate('2027-01-26')).toEqual({ date: '2027-01-26' });
    expect(parseHolidayDate('26-01-2027')).toEqual({ date: '2027-01-26' });
    expect(parseHolidayDate('26.01.2027')).toEqual({ date: '2027-01-26' });
  });

  it('accepts an unambiguous slash date but rejects one that reads both ways', () => {
    expect(parseHolidayDate('26/01/2027')).toEqual({ date: '2027-01-26' });
    expect(parseHolidayDate('03/04/2027')).toEqual({ error: expect.stringMatching(/ambiguous/) });
    expect(parseHolidayDate('05/05/2027')).toEqual({ date: '2027-05-05' }); // same either way
  });

  it('rejects non-dates and impossible dates', () => {
    expect(parseHolidayDate('Holi')).toEqual({ error: expect.stringMatching(/not a date/) });
    expect(parseHolidayDate('31-02-2027')).toEqual({
      error: expect.stringMatching(/real calendar date/),
    });
  });
});

describe('parseHolidaySheet', () => {
  it('reads PUBLIC/OPTIONAL types (blank = PUBLIC) and reports bad rows', () => {
    const { holidays, issues } = parseHolidaySheet(
      sheet([
        { date: '26-01-2027', name: 'Republic Day' },
        { date: '14-03-2027', name: 'Holi', type: 'Optional' },
        { date: '15-08-2026', name: 'Independence Day', type: 'national' },
        { date: '', name: 'Nameless date' },
        { date: '02-10-2026', name: 'Gandhi Jayanti', type: 'sometimes' },
      ]),
    );
    expect(holidays.map((h) => [h.date, h.optional])).toEqual([
      ['2027-01-26', false],
      ['2027-03-14', true],
      ['2026-08-15', false],
    ]);
    expect(issues.map((i) => [i.row, i.message])).toEqual([
      [5, 'date is required'],
      [6, 'type "sometimes" must be PUBLIC or OPTIONAL'],
    ]);
  });
});

describe('validateHolidays', () => {
  const h = (date: string, name: string, row?: number) => ({ date, name, optional: false, row });
  // A holiday late in the year, so a test isn't also tripping the "list looks incomplete" warning.
  const late = h('2027-02-01', 'Late-year holiday');

  it('passes a clean list', () => {
    expect(
      validateHolidays([h('2026-08-14', 'A'), h('2027-01-26', 'Republic Day')], ctx()),
    ).toEqual([]);
  });

  it('errors on the same date + name twice', () => {
    const issues = validateHolidays(
      [h('2026-08-14', 'Diwali', 2), h('2026-08-14', 'diwali ', 3), late],
      ctx(),
    );
    expect(issues).toEqual([expect.objectContaining({ level: 'error', row: 3 })]);
  });

  it('warns on two different holidays on one date', () => {
    const issues = validateHolidays([h('2026-08-14', 'A'), h('2026-08-14', 'B'), late], ctx());
    expect(issues).toEqual([
      expect.objectContaining({ level: 'warning', message: expect.stringMatching(/2 holidays/) }),
    ]);
  });

  it('warns on a weekly off', () => {
    const issues = validateHolidays([h('2026-08-15', 'Independence Day'), late], ctx()); // a Saturday
    expect(issues).toEqual([
      expect.objectContaining({ level: 'warning', message: expect.stringMatching(/Saturday/) }),
    ]);
  });

  it('errors outside the current and next leave year', () => {
    const issues = validateHolidays(
      [h('2026-03-31', 'Too early'), h('2028-04-01', 'Too late')],
      ctx(),
    );
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(2);
  });

  it('errors on a new holiday in a payroll-processed month, but not on one already saved', () => {
    const locked = ctx({
      lockedMonths: new Set(['2026-08']),
      existingKeys: new Set(['2026-08-14|saved']),
    });
    const issues = validateHolidays(
      [h('2026-08-13', 'New'), h('2026-08-14', 'Saved'), late],
      locked,
    );
    expect(issues).toEqual([expect.objectContaining({ level: 'error', date: '2026-08-13' })]);
  });

  it('warns when the list stops well before the leave year ends', () => {
    const issues = validateHolidays([h('2026-08-14', 'Only one')], ctx());
    expect(issues).toEqual([
      expect.objectContaining({ level: 'warning', message: expect.stringMatching(/complete/) }),
    ]);
  });
});
