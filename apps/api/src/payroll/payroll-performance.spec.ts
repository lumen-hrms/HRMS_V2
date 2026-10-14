import { calculatePayroll, type CalculatorComponent } from './payroll-calculator';
import { generatePayslipPdf } from './payslip-generator';

/**
 * Module 07 Phase 9 scale check for the CPU-bound parts of a run: the pure
 * calculator at ~5,000 employees and payslip PDF generation at ~500. These
 * are deliberately loose regression guards (CI machines vary), not
 * benchmarks — the budgets sit an order of magnitude above observed times so
 * a flake means a real algorithmic regression. Database round-trips (the
 * other half of a run) are covered by the live-environment checklist in
 * docs/modules/07_PAYROLL_ENGINE.md §9.
 */
const COMPONENTS: CalculatorComponent[] = [
  { type: 'BASIC', code: 'BASIC', calculationMode: 'PERCENT_OF_CTC', value: 40 },
  { type: 'HRA', code: 'HRA', calculationMode: 'PERCENT_OF_BASIC', value: 40 },
  { type: 'SPECIAL_ALLOWANCE', code: 'SPECIAL_ALLOWANCE', calculationMode: 'FIXED', value: 8000 },
];

function calcInput(i: number) {
  return {
    components: COMPONENTS,
    ctcAnnual: 400000 + (i % 50) * 20000,
    workingDays: 26,
    payableDays: 26 - (i % 4),
    epf: {
      ceiling: 15000,
      allowAboveCeiling: false,
      employeeRate: 12,
      epsRate: 8.33,
      employerRate: 3.67,
      adminRate: 0.5,
      edliRate: 0.5,
    },
    esi: { wageCeiling: 21000, employeeRate: 0.75, employerRate: 3.25 },
    ptSlabs: [
      { grossFrom: 0, grossTo: 15000, monthlyAmount: 0 },
      { grossFrom: 15000, grossTo: null, monthlyAmount: 200 },
    ],
    month: 1 + (i % 12),
    tds: i % 7 === 0 ? 1500 : 0,
  };
}

describe('payroll performance guards', () => {
  it('calculates 5,000 employees well inside budget', () => {
    const start = process.hrtime.bigint();
    let netTotal = 0;
    for (let i = 0; i < 5000; i += 1) {
      netTotal += calculatePayroll(calcInput(i)).netPay.toNumber();
    }
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`payroll-calculator: 5,000 employees in ${ms.toFixed(0)} ms`);
    expect(netTotal).toBeGreaterThan(0);
    expect(ms).toBeLessThan(10_000);
  });

  it('generates 500 password-protected payslip PDFs well inside budget', async () => {
    const start = process.hrtime.bigint();
    for (let i = 0; i < 500; i += 1) {
      const buf = await generatePayslipPdf({
        employeeName: `Employee ${i}`,
        employeeCode: `E${i}`,
        period: '2026-09',
        dateOfBirth: new Date('1990-05-15T00:00:00Z'),
        workingDays: 26,
        payableDays: 26,
        lopDays: 0,
        earnings: [{ code: 'BASIC', amount: 30000 }],
        grossEarnings: 42000,
        epfEmployee: 1800,
        esiEmployee: 0,
        professionalTax: 200,
        tdsDeducted: 0,
        adHocAdjustments: [],
        netPay: 40000,
      });
      expect(buf.length).toBeGreaterThan(0);
    }
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`payslip-generator: 500 PDFs in ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(60_000);
  }, 90_000);
});
