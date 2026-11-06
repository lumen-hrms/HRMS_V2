import {
  calculateGratuity,
  calculateLeaveEncashment,
  completedYearsOfService,
} from './full-and-final-calculator';

describe('completedYearsOfService', () => {
  it('rounds up a trailing part-year of more than 6 months past the last anniversary (Act §4(2))', () => {
    // Last (5th) anniversary 2025-01-15 -> 2026-01-14 is 11 months 30 days
    // past it, well over 6 months, so this counts as a 6th year.
    expect(completedYearsOfService(new Date('2020-01-15'), new Date('2026-01-14'))).toBe(6);
  });

  it('counts the full year exactly on the anniversary date', () => {
    expect(completedYearsOfService(new Date('2020-01-15'), new Date('2026-01-15'))).toBe(6);
  });

  it('does not round up at exactly 6 months past the last anniversary', () => {
    expect(completedYearsOfService(new Date('2020-01-15'), new Date('2026-07-15'))).toBe(6);
  });

  it('rounds up at 6 months and 1 day past the last anniversary', () => {
    expect(completedYearsOfService(new Date('2020-01-15'), new Date('2026-07-16'))).toBe(7);
  });

  it('is zero on the joining date itself', () => {
    expect(completedYearsOfService(new Date('2020-06-01'), new Date('2020-06-01'))).toBe(0);
  });

  it('never goes negative, even with a "to" before "from"', () => {
    expect(completedYearsOfService(new Date('2026-01-01'), new Date('2020-01-01'))).toBe(0);
  });
});

describe('calculateGratuity', () => {
  it('pays 0 below the eligibility threshold', () => {
    const g = calculateGratuity({
      lastDrawnBasic: 50000,
      completedYears: 4,
      eligibilityYears: 5,
      daysPerYear: 15,
      monthDivisor: 26,
      maxAmount: 2000000,
    });
    expect(g.toNumber()).toBe(0);
  });

  it('computes 15/26 x lastDrawnBasic x completedYears exactly at the threshold', () => {
    // 50,000 x 15 / 26 x 5 = 144,230.7692... -> 144,230.77
    const g = calculateGratuity({
      lastDrawnBasic: 50000,
      completedYears: 5,
      eligibilityYears: 5,
      daysPerYear: 15,
      monthDivisor: 26,
      maxAmount: 2000000,
    });
    expect(g.toNumber()).toBe(144230.77);
  });

  it('respects a tenant-edited formula (different days/divisor)', () => {
    // 60,000 x 30 / 30 x 10 = 600,000.00
    const g = calculateGratuity({
      lastDrawnBasic: 60000,
      completedYears: 10,
      eligibilityYears: 5,
      daysPerYear: 30,
      monthDivisor: 30,
      maxAmount: 2000000,
    });
    expect(g.toNumber()).toBe(600000);
  });

  it('caps the payout at maxAmount (statutory ₹20L ceiling, S.O. 1420(E))', () => {
    // Uncapped: 500,000 x 15 / 26 x 30 = 8,653,846.15 -> clamped to 2,000,000.
    const g = calculateGratuity({
      lastDrawnBasic: 500000,
      completedYears: 30,
      eligibilityYears: 5,
      daysPerYear: 15,
      monthDivisor: 26,
      maxAmount: 2000000,
    });
    expect(g.toNumber()).toBe(2000000);
  });
});

describe('calculateLeaveEncashment', () => {
  it('computes (componentsMonthlyTotal / divisor) x encashableDays', () => {
    // 50,000 / 26 x 10 = 19,230.7692... -> 19,230.77
    const e = calculateLeaveEncashment({
      encashableDays: 10,
      componentsMonthlyTotal: 50000,
      divisor: 26,
    });
    expect(e.toNumber()).toBe(19230.77);
  });

  it('is 0 when the balance is 0', () => {
    const e = calculateLeaveEncashment({
      encashableDays: 0,
      componentsMonthlyTotal: 50000,
      divisor: 26,
    });
    expect(e.toNumber()).toBe(0);
  });
});
