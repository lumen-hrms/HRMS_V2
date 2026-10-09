import {
  calculateGratuity,
  calculateLeaveEncashment,
  completedYearsOfService,
} from './full-and-final-calculator';

describe('completedYearsOfService', () => {
  it('is one day short of the next full year the day before the anniversary', () => {
    expect(completedYearsOfService(new Date('2020-01-15'), new Date('2026-01-14'))).toBe(5);
  });

  it('counts the full year exactly on the anniversary date', () => {
    expect(completedYearsOfService(new Date('2020-01-15'), new Date('2026-01-15'))).toBe(6);
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
    });
    expect(g.toNumber()).toBe(600000);
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
