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
    // taxableIncome = 1,500,000 - 75,000 (std. deduction) = 1,425,000
    // 4L-8L@5% = 20,000; 8L-12L@10% = 40,000; 12L-14.25L@15% = 33,750
    // tax = 93,750; +4% cess = 97,500
    const tax = projectAnnualTax({
      projectedAnnualGross: 1500000,
      declaredExemptions: 0,
      slabs: NEW_SLABS,
      config: NEW_CONFIG,
      marginalRelief: true,
    });
    expect(tax.toNumber()).toBe(97500);
  });

  it('zeroes out via the 87A rebate exactly at the threshold', () => {
    // taxableIncome = 1,275,000 - 75,000 = 1,200,000 (== rebateThreshold)
    // 4L-8L@5% = 20,000; 8L-12L@10% = 40,000 -> tax 60,000, fully rebated
    const tax = projectAnnualTax({
      projectedAnnualGross: 1275000,
      declaredExemptions: 0,
      slabs: NEW_SLABS,
      config: NEW_CONFIG,
      marginalRelief: true,
    });
    expect(tax.toNumber()).toBe(0);
  });

  it('without marginal relief the rebate cliff is total', () => {
    const tax = projectAnnualTax({
      projectedAnnualGross: 1275001,
      declaredExemptions: 0,
      slabs: NEW_SLABS,
      config: NEW_CONFIG,
    });
    expect(tax.toNumber()).toBeGreaterThan(60000);
  });

  it('marginal relief caps tax at the income earned over the threshold (NEW)', () => {
    // taxableIncome = 1,210,000: slab tax 61,500 but only 10,000 over 12L
    // -> tax 10,000; +4% cess = 10,400
    const tax = projectAnnualTax({
      projectedAnnualGross: 1285000,
      declaredExemptions: 0,
      slabs: NEW_SLABS,
      config: NEW_CONFIG,
      marginalRelief: true,
    });
    expect(tax.toNumber()).toBe(10400);
  });

  it('marginal relief stops mattering once slab tax is below the excess', () => {
    // 1,275,000 taxable: slab tax 71,250 vs 75,000 excess -> slab tax wins
    const tax = projectAnnualTax({
      projectedAnnualGross: 1350000,
      declaredExemptions: 0,
      slabs: NEW_SLABS,
      config: NEW_CONFIG,
      marginalRelief: true,
    });
    expect(tax.toNumber()).toBe(74100);
  });

  it('OLD regime keeps the hard 87A cliff at ₹5L', () => {
    // 550,000 gross - 50,000 = 500,000 taxable: 12,500 fully rebated
    const at = projectAnnualTax({
      projectedAnnualGross: 550000,
      declaredExemptions: 0,
      slabs: OLD_SLABS,
      config: OLD_CONFIG,
    });
    expect(at.toNumber()).toBe(0);
    const over = projectAnnualTax({
      projectedAnnualGross: 550100,
      declaredExemptions: 0,
      slabs: OLD_SLABS,
      config: OLD_CONFIG,
    });
    expect(over.toNumber()).toBeGreaterThan(12000);
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
    // projectedAnnualGross = 150,000 x 12 = 1,800,000; taxableIncome = 1,725,000
    // 4-8L@5%=20,000; 8-12L@10%=40,000; 12-16L@15%=60,000; 16-17.25L@20%=25,000
    // -> 145,000; +4% cess = 150,800; / 12 months = 12,566.67 -> 12,567
    const monthly = computeMonthlyTds({
      regime: 'NEW',
      currentMonthGross: 150000,
      elapsedGross: 0,
      alreadyDeducted: 0,
      remainingMonths: 12,
      declaredExemptions: 0,
      slabs: NEW_SLABS,
      config: NEW_CONFIG,
    });
    expect(monthly.toNumber()).toBe(12567);
  });

  it('mid-year at a steady gross reproduces the same monthly figure (smoothing is stable)', () => {
    // By October (remainingMonths=6): elapsed 6 months @ 150,000 = 900,000 gross,
    // already deducted ~6 x 12,567 = 75,400. Same annual projection as the April
    // case (1,800,000) -> annual tax 150,800 -> remaining 75,400 / 6 = 12,567.
    const monthly = computeMonthlyTds({
      regime: 'NEW',
      currentMonthGross: 150000,
      elapsedGross: 900000,
      alreadyDeducted: 75400,
      remainingMonths: 6,
      declaredExemptions: 0,
      slabs: NEW_SLABS,
      config: NEW_CONFIG,
    });
    expect(monthly.toNumber()).toBe(12567);
  });

  it('a mid-year salary revision re-projects and re-smooths the remainder', () => {
    // Same elapsed history as above, but this month's gross jumps to 200,000.
    // projectedAnnualGross = 900,000 + 200,000 x 6 = 2,100,000; taxableIncome = 2,025,000
    // 20,000 + 40,000 + 60,000 + 16-20L@20% 80,000 + 20-20.25L@25% 6,250 = 206,250
    // +4% cess = 214,500; remaining = 214,500 - 75,400 = 139,100 / 6 = 23,183
    const monthly = computeMonthlyTds({
      regime: 'NEW',
      currentMonthGross: 200000,
      elapsedGross: 900000,
      alreadyDeducted: 75400,
      remainingMonths: 6,
      declaredExemptions: 0,
      slabs: NEW_SLABS,
      config: NEW_CONFIG,
    });
    expect(monthly.toNumber()).toBe(23183);
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
      currentMonthGross: 150000,
      elapsedGross: 0,
      alreadyDeducted: 0,
      remainingMonths: 12,
      declaredExemptions: 200000,
      slabs: NEW_SLABS,
      config: NEW_CONFIG,
    });
    expect(withExemptions.toNumber()).toBe(12567); // same as the no-exemptions April case
  });

  it('accepts Decimal inputs for the historical figures, not just numbers', () => {
    const monthly = computeMonthlyTds({
      regime: 'NEW',
      currentMonthGross: new Prisma.Decimal(150000),
      elapsedGross: new Prisma.Decimal(900000),
      alreadyDeducted: new Prisma.Decimal(75400),
      remainingMonths: 6,
      declaredExemptions: 0,
      slabs: NEW_SLABS,
      config: NEW_CONFIG,
    });
    expect(monthly.toNumber()).toBe(12567);
  });
});
