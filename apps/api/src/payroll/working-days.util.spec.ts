import { computePayableDays, countWorkingDays, effectiveWeeklyOffDays } from './working-days.util';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('countWorkingDays', () => {
  it('excludes weekly offs and holidays, inclusive of both endpoints', () => {
    // September 2026, 1st..15th = 15 calendar days. Two full weekends fall
    // inside the range (5th-6th, 12th-13th = 4 days); 2026-09-15 (a
    // Tuesday) is a declared holiday.
    const count = countWorkingDays(
      d('2026-09-01'),
      d('2026-09-15'),
      new Set(['2026-09-15']),
      [0, 6],
    );
    // 15 days - 4 weekend days - 1 holiday (15th) = 10.
    expect(count).toBe(10);
  });

  it('returns 0 for an empty/inverted range', () => {
    expect(countWorkingDays(d('2026-09-10'), d('2026-09-01'), new Set(), [0, 6])).toBe(0);
  });
});

describe('effectiveWeeklyOffDays', () => {
  it('falls back to the tenant default when no override is set', () => {
    expect(effectiveWeeklyOffDays([0, 6], undefined)).toEqual([0, 6]);
    expect(effectiveWeeklyOffDays([0, 6], null)).toEqual([0, 6]);
    expect(effectiveWeeklyOffDays([0, 6], [])).toEqual([0, 6]);
  });

  it('uses the per-employee override when set (decision 14)', () => {
    expect(effectiveWeeklyOffDays([0, 6], [2])).toEqual([2]);
  });
});

describe('computePayableDays', () => {
  const sept = { start: d('2026-09-01'), end: d('2026-09-30') };
  const noHolidays = new Set<string>();
  const weekends = [0, 6];

  it('a full month with no LOP is fully payable', () => {
    const { workingDays, payableDays } = computePayableDays(
      sept.start,
      sept.end,
      noHolidays,
      weekends,
      0,
    );
    // September 2026 has 4 full weekends -> 30 - 8 = 22 working days.
    expect(workingDays).toBe(22);
    expect(payableDays).toBe(22);
  });

  it('whole-day LOP reduces payable days but not the working-day denominator', () => {
    const { workingDays, payableDays } = computePayableDays(
      sept.start,
      sept.end,
      noHolidays,
      weekends,
      3,
    );
    expect(workingDays).toBe(22);
    expect(payableDays).toBe(19);
  });

  it('a mid-month joiner is only payable from their join date', () => {
    const { workingDays, payableDays } = computePayableDays(
      sept.start,
      sept.end,
      noHolidays,
      weekends,
      0,
      d('2026-09-16'), // joined on the 16th (a Wednesday)
    );
    expect(workingDays).toBe(22);
    // 16th..30th: 15 calendar days minus two weekends (19-20, 26-27) = 11.
    expect(payableDays).toBe(11);
  });

  it('a mid-month exit is only payable up to their last day', () => {
    const { workingDays, payableDays } = computePayableDays(
      sept.start,
      sept.end,
      noHolidays,
      weekends,
      0,
      undefined,
      d('2026-09-15'), // last day the 15th (a Tuesday)
    );
    expect(workingDays).toBe(22);
    // 1st..15th: 15 calendar days minus two weekends (5-6, 12-13) = 11.
    expect(payableDays).toBe(11);
  });

  it('LOP cannot push payable days below zero', () => {
    const { payableDays } = computePayableDays(sept.start, sept.end, noHolidays, weekends, 999);
    expect(payableDays).toBe(0);
  });
});
