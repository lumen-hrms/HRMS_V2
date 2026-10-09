import { Prisma } from '@prisma/client';
import { computeMonthlyTds, projectAnnualTax, type TaxSlabRow } from './tds-calculator';
import { DEFAULT_TAX_REGIME_CONFIG, DEFAULT_TAX_SLABS } from './payroll-defaults';

// DEFAULT_TAX_SLABS uses the seed shape ({from, to}); the calculator's
// TaxSlabRow uses the Prisma column names ({incomeFrom, incomeTo}).
function toSlabRows(seeds: typeof DEFAULT_TAX_SLABS.NEW): TaxSlabRow[] {
  return seeds.map((s) => ({ incomeFrom: s.from, incomeTo: s.to, ratePercent: s.ratePercent }));
}

const NEW_SLABS = toSlabRows(DEFAULT_TAX_SLABS.NEW);
const NEW_CONFIG = DEFAULT_TAX_REGIME_CONFIG.NEW;
const OLD_SLABS = toSlabRows(DEFAULT_TAX_SLABS.OLD);
const OLD_CONFIG = DEFAULT_TAX_REGIME_CONFIG.OLD;

describe('projectAnnualTax', () => {
  it('computes progressive slab tax + cess, NEW regime, above the 87A rebate threshold', () => {
    // taxableIncome = 1,000,000 - 75,000 (std. deduction) = 925,000
    // 300k-600k@5% = 15,000; 600k-900k@10% = 30,000; 900k-925k@15% = 3,750
    // tax = 48,750; +4% cess = 50,700
    const tax = projectAnnualTax({
      projectedAnnualGross: 1000000,
      declaredExemptions: 0,
      slabs: NEW_SLABS,
      config: NEW_CONFIG,
    });
    expect(tax.toNumber()).toBe(50700);
  });

  it('zeroes out via the 87A rebate exactly at the threshold', () => {
    // taxableIncome = 775,000 - 75,000 = 700,000 (== rebateThreshold)
    // 300k-600k@5% = 15,000; 600k-700k@10% = 10,000 -> tax = 25,000
    // rebate caps it at max(0, 25,000 - 25,000) = 0
    const tax = projectAnnualTax({
      projectedAnnualGross: 775000,
      declaredExemptions: 0,
      slabs: NEW_SLABS,
      config: NEW_CONFIG,
    });
    expect(tax.toNumber()).toBe(0);
  });

  it('does not rebate just above the threshold', () => {
    // taxableIncome = 775001 - 75000 = 700001, one rupee over the threshold
    const tax = projectAnnualTax({
      projectedAnnualGross: 775001,
      declaredExemptions: 0,
      slabs: NEW_SLABS,
      config: NEW_CONFIG,
    });
    expect(tax.toNumber()).toBeGreaterThan(0);
  });

  it('OLD regime applies declared exemptions before the slabs', () => {
    // taxableIncome = 900,000 - 50,000 (std. deduction) - 150,000 (declared) = 700,000
    // 250k-500k@5% = 12,500; 500k-700k@20% = 40,000 -> tax = 52,500
    // 700,000 > rebateThreshold (500,000): no rebate; +4% cess = 54,600
    const tax = projectAnnualTax({
      projectedAnnualGross: 900000,
      declaredExemptions: 150000,
      slabs: OLD_SLABS,
      config: OLD_CONFIG,
    });
    expect(tax.toNumber()).toBe(54600);
  });

  it('a zero-income projection owes no tax', () => {
    const tax = projectAnnualTax({
      projectedAnnualGross: 0,
      declaredExemptions: 0,
      slabs: NEW_SLABS,
      config: NEW_CONFIG,
    });
    expect(tax.toNumber()).toBe(0);
  });
});

describe('computeMonthlyTds', () => {
  it('April (12 months remaining): annualises the current month and divides evenly', () => {
    // projectedAnnualGross = 0 + 100,000 x 12 = 1,200,000; taxableIncome = 1,125,000
    // 300k-600k@5%=15,000; 600k-900k@10%=30,000; 900k-1,200k@15%=33,750 -> 78,750
    // +4% cess = 81,900; / 12 months = 6,825
    const monthly = computeMonthlyTds({
      regime: 'NEW',
      currentMonthGross: 100000,
      elapsedGross: 0,
      alreadyDeducted: 0,
      remainingMonths: 12,
      declaredExemptions: 0,
      slabs: NEW_SLABS,
      config: NEW_CONFIG,
    });
    expect(monthly.toNumber()).toBe(6825);
  });

  it('mid-year at a steady gross reproduces the same monthly figure (smoothing is stable)', () => {
    // By October (remainingMonths=6): elapsed 6 months @ 100,000 = 600,000 gross,
    // already deducted 6 x 6,825 = 40,950. Same annual projection as the April
    // case (1,200,000) -> same annual tax (81,900) -> remaining 40,950 / 6 = 6,825.
    const monthly = computeMonthlyTds({
      regime: 'NEW',
      currentMonthGross: 100000,
      elapsedGross: 600000,
      alreadyDeducted: 40950,
      remainingMonths: 6,
      declaredExemptions: 0,
      slabs: NEW_SLABS,
      config: NEW_CONFIG,
    });
    expect(monthly.toNumber()).toBe(6825);
  });

  it('a mid-year salary revision re-projects and re-smooths the remainder', () => {
    // Same elapsed history as above, but this month's gross jumps to 150,000.
    // projectedAnnualGross = 600,000 + 150,000 x 6 = 1,500,000; taxableIncome = 1,425,000
    // 300-600k@5%=15,000; 600-900k@10%=30,000; 900-1,200k@15%=45,000;
    // 1,200-1,425k@20%=45,000 -> 135,000; +4% cess = 140,400
    // remaining = 140,400 - 40,950 = 99,450 / 6 months = 16,575
    const monthly = computeMonthlyTds({
      regime: 'NEW',
      currentMonthGross: 150000,
      elapsedGross: 600000,
      alreadyDeducted: 40950,
      remainingMonths: 6,
      declaredExemptions: 0,
      slabs: NEW_SLABS,
      config: NEW_CONFIG,
    });
    expect(monthly.toNumber()).toBe(16575);
  });

  it('never goes negative when already-deducted exceeds the (re-)projected annual tax', () => {
    const monthly = computeMonthlyTds({
      regime: 'NEW',
      currentMonthGross: 10000,
      elapsedGross: 1000000,
      alreadyDeducted: 500000,
      remainingMonths: 3,
      declaredExemptions: 0,
      slabs: NEW_SLABS,
      config: NEW_CONFIG,
    });
    expect(monthly.toNumber()).toBe(0);
  });

  it('is zero once no months remain', () => {
    const monthly = computeMonthlyTds({
      regime: 'NEW',
      currentMonthGross: 100000,
      elapsedGross: 1200000,
      alreadyDeducted: 0,
      remainingMonths: 0,
      declaredExemptions: 0,
      slabs: NEW_SLABS,
      config: NEW_CONFIG,
    });
    expect(monthly.toNumber()).toBe(0);
  });

  it('ignores declaredExemptions on the NEW regime', () => {
    const withExemptions = computeMonthlyTds({
      regime: 'NEW',
      currentMonthGross: 100000,
      elapsedGross: 0,
      alreadyDeducted: 0,
      remainingMonths: 12,
      declaredExemptions: 200000,
      slabs: NEW_SLABS,
      config: NEW_CONFIG,
    });
    expect(withExemptions.toNumber()).toBe(6825); // same as the no-exemptions April case
  });

  it('accepts Decimal inputs for the historical figures, not just numbers', () => {
    const monthly = computeMonthlyTds({
      regime: 'NEW',
      currentMonthGross: new Prisma.Decimal(100000),
      elapsedGross: new Prisma.Decimal(600000),
      alreadyDeducted: new Prisma.Decimal(40950),
      remainingMonths: 6,
      declaredExemptions: 0,
      slabs: NEW_SLABS,
      config: NEW_CONFIG,
    });
    expect(monthly.toNumber()).toBe(6825);
  });
});
