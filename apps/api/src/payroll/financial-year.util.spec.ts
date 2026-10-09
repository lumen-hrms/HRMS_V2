import {
  elapsedPeriodsInFinancialYear,
  financialYear,
  financialYearPeriods,
  monthsRemainingInFinancialYear,
} from './financial-year.util';

describe('financialYear', () => {
  it('April through December map to the current calendar year as the FY start', () => {
    expect(financialYear('2026-04')).toBe('2026-27');
    expect(financialYear('2026-09')).toBe('2026-27');
    expect(financialYear('2026-12')).toBe('2026-27');
  });

  it('January through March map to the previous calendar year as the FY start', () => {
    expect(financialYear('2027-01')).toBe('2026-27');
    expect(financialYear('2027-03')).toBe('2026-27');
  });
});

describe('financialYearPeriods', () => {
  it('returns all 12 months April through March, in order, for any period in that FY', () => {
    const expected = [
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
    ];
    expect(financialYearPeriods('2026-04')).toEqual(expected);
    expect(financialYearPeriods('2026-11')).toEqual(expected);
    expect(financialYearPeriods('2027-03')).toEqual(expected);
  });
});

describe('monthsRemainingInFinancialYear', () => {
  it('is 12 in April and 1 in March, counting the queried month itself', () => {
    expect(monthsRemainingInFinancialYear('2026-04')).toBe(12);
    expect(monthsRemainingInFinancialYear('2027-03')).toBe(1);
  });

  it('counts down correctly mid-year', () => {
    expect(monthsRemainingInFinancialYear('2026-09')).toBe(7); // Sep..Mar inclusive
  });
});

describe('elapsedPeriodsInFinancialYear', () => {
  it('is empty in April', () => {
    expect(elapsedPeriodsInFinancialYear('2026-04')).toEqual([]);
  });

  it('lists every prior month of the same FY, chronological', () => {
    expect(elapsedPeriodsInFinancialYear('2026-09')).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
    ]);
  });

  it("spans the calendar-year boundary (Jan/Feb/Mar belong to the previous April's FY)", () => {
    expect(elapsedPeriodsInFinancialYear('2027-01')).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
  });
});
