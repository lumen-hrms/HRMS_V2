import { Prisma } from '@prisma/client';
import {
  calculatePayroll,
  PayrollCalculationError,
  type CalculatorComponent,
  type EpfConfig,
  type EsiConfig,
} from './payroll-calculator';
import type { PtSlabRow } from './professional-tax.util';

const n = (v: Prisma.Decimal) => v.toNumber();

// Defaults mirror PayrollSettings' column defaults (Phase 1).
const EPF: EpfConfig = {
  ceiling: 15000,
  allowAboveCeiling: false,
  employeeRate: 12,
  epsRate: 8.33,
  employerRate: 3.67,
  adminRate: 0.5,
  edliRate: 0.5,
};
const ESI: EsiConfig = { wageCeiling: 21000, employeeRate: 0.75, employerRate: 3.25 };

// Hypothetical slab shape, not real rates (decision 11 defers verification).
const PT_SLABS: PtSlabRow[] = [
  { grossFrom: 0, grossTo: 15000, monthlyAmount: 0 },
  { grossFrom: 15000, grossTo: 25000, monthlyAmount: 200 },
  { grossFrom: 25000, grossTo: null, monthlyAmount: 300 },
];

/** BASIC 30000, HRA 40% of Basic (12000), Special Allowance 8000 fixed = 50000 gross. */
function standardComponents(
  overrides: Partial<Record<string, number>> = {},
): CalculatorComponent[] {
  return [
    { type: 'BASIC', code: 'BASIC', calculationMode: 'FIXED', value: overrides.BASIC ?? 30000 },
    { type: 'HRA', code: 'HRA', calculationMode: 'PERCENT_OF_BASIC', value: 40 },
    {
      type: 'SPECIAL_ALLOWANCE',
      code: 'SPECIAL_ALLOWANCE',
      calculationMode: 'FIXED',
      value: overrides.SPECIAL_ALLOWANCE ?? 8000,
    },
  ];
}

function baseInput(overrides: Partial<Parameters<typeof calculatePayroll>[0]> = {}) {
  return {
    components: standardComponents(),
    ctcAnnual: 600000,
    workingDays: 23,
    payableDays: 23,
    epf: EPF,
    esi: ESI,
    ptSlabs: PT_SLABS,
    month: 5,
    ...overrides,
  };
}

describe('calculatePayroll — EPF', () => {
  it('caps EPF wages at the ceiling by default', () => {
    const r = calculatePayroll(baseInput());
    expect(n(r.epf.wages)).toBe(15000);
    expect(n(r.epf.employeeContribution)).toBe(1800);
    expect(n(r.epf.epsContribution)).toBe(1250);
    expect(n(r.epf.employerPfContribution)).toBe(551);
    expect(n(r.epf.adminCharge)).toBe(75);
    expect(n(r.epf.edliContribution)).toBe(75);
  });

  it('uses uncapped Basic when the tenant allows contribution above the ceiling', () => {
    const r = calculatePayroll(baseInput({ epf: { ...EPF, allowAboveCeiling: true } }));
    expect(n(r.epf.wages)).toBe(30000);
    expect(n(r.epf.employeeContribution)).toBe(3600);
    expect(n(r.epf.epsContribution)).toBe(2499);
    expect(n(r.epf.employerPfContribution)).toBe(1101);
  });

  it('EPF wages below the ceiling are used as-is', () => {
    const r = calculatePayroll(
      baseInput({ components: standardComponents({ BASIC: 10000, SPECIAL_ALLOWANCE: 3000 }) }),
    );
    expect(n(r.epf.wages)).toBe(10000);
    expect(n(r.epf.employeeContribution)).toBe(1200);
  });
});

describe('calculatePayroll — ESI', () => {
  it('applies when the full monthly gross is at or under the ceiling', () => {
    const r = calculatePayroll(
      baseInput({ components: standardComponents({ BASIC: 12000, SPECIAL_ALLOWANCE: 4200 }) }),
    );
    // gross = 12000 + 4800 (HRA) + 4200 = 21000
    expect(r.esi.applicable).toBe(true);
    expect(n(r.esi.employeeContribution)).toBe(158);
    expect(n(r.esi.employerContribution)).toBe(683);
  });

  it('does not apply one rupee over the ceiling', () => {
    const r = calculatePayroll(
      baseInput({ components: standardComponents({ BASIC: 12000, SPECIAL_ALLOWANCE: 4201 }) }),
    );
    // gross = 12000 + 4800 + 4201 = 21001
    expect(r.esi.applicable).toBe(false);
    expect(n(r.esi.employeeContribution)).toBe(0);
    expect(n(r.esi.employerContribution)).toBe(0);
  });

  it('full case: ESI-eligible gross flows through to net pay correctly', () => {
    const r = calculatePayroll(
      baseInput({ components: standardComponents({ BASIC: 10000, SPECIAL_ALLOWANCE: 3000 }) }),
    );
    // gross = 10000 + 4000 (HRA) + 3000 = 17000
    expect(n(r.grossEarnings)).toBe(17000);
    expect(r.esi.applicable).toBe(true);
    expect(n(r.esi.employeeContribution)).toBe(128);
    expect(n(r.professionalTax)).toBe(200);
    expect(n(r.epf.employeeContribution)).toBe(1200);
    expect(n(r.netPay)).toBe(15472);
  });
});

describe('calculatePayroll — Professional Tax', () => {
  it('picks the slab matching the actual (prorated) gross paid', () => {
    const r = calculatePayroll(baseInput());
    expect(n(r.grossEarnings)).toBe(50000);
    expect(n(r.professionalTax)).toBe(300);
  });
});

describe('calculatePayroll — LOP proration', () => {
  it('a 20-working-day month with 2 LOP days prorates every earning by 18/20', () => {
    const r = calculatePayroll(baseInput({ workingDays: 20, payableDays: 18 }));
    expect(n(r.grossEarnings)).toBe(45000);
    expect(n(r.lopDeduction)).toBe(5000);
    // Basic (27000) stays above the EPF ceiling, so the cap still applies.
    expect(n(r.epf.wages)).toBe(15000);
    expect(n(r.professionalTax)).toBe(300);
    expect(n(r.netPay)).toBe(42900);
  });

  it('a 23-working-day month with 2 LOP days prorates every earning by 21/23', () => {
    const r = calculatePayroll(baseInput({ workingDays: 23, payableDays: 21 }));
    expect(n(r.grossEarnings)).toBe(45652.17);
    expect(n(r.lopDeduction)).toBe(4347.83);
    expect(n(r.professionalTax)).toBe(300);
    expect(n(r.netPay)).toBe(43552.17);
  });

  it('a mid-month joiner is just a smaller payableDays, prorated the same way', () => {
    // Equivalent to working-days.util's joiner fixture: 22 working days,
    // 11 actually employed — same proration mechanism as LOP.
    const r = calculatePayroll(baseInput({ workingDays: 22, payableDays: 11 }));
    expect(n(r.payableFactor)).toBe(0.5);
    expect(n(r.grossEarnings)).toBe(25000);
  });
});

describe('calculatePayroll — invariants', () => {
  it('net pay always equals gross minus the summed deductions', () => {
    const r = calculatePayroll(baseInput({ tds: 500 }));
    const summed = r.epf.employeeContribution
      .plus(r.esi.employeeContribution)
      .plus(r.professionalTax)
      .plus(r.tds);
    expect(n(r.totalDeductions)).toBe(n(summed));
    expect(n(r.netPay)).toBe(n(r.grossEarnings.minus(summed)));
  });

  it('rejects payableDays greater than workingDays', () => {
    expect(() => calculatePayroll(baseInput({ workingDays: 20, payableDays: 21 }))).toThrow(
      PayrollCalculationError,
    );
  });

  it('refuses to silently produce a negative net pay', () => {
    const harshSlabs: PtSlabRow[] = [{ grossFrom: 0, grossTo: null, monthlyAmount: 200 }];
    const input = baseInput({ workingDays: 23, payableDays: 0, ptSlabs: harshSlabs });
    expect(() => calculatePayroll(input)).toThrow(PayrollCalculationError);
    expect(n(calculatePayroll({ ...input, allowNegativeNet: true }).netPay)).toBe(-200);
  });
});

describe('calculatePayroll — Overtime (module 07 Phase 4, decision 6)', () => {
  it('adds hours x hourlyRate x multiplier as an earning, excluded from EPF wages, included in gross/ESI/PT', () => {
    const r = calculatePayroll(
      baseInput({
        overtime: { hours: 5, hourlyRate: 30000 / (23 * 8), multiplier: 2 },
      }),
    );
    expect(n(r.overtimePay)).toBe(1630.43);
    expect(n(r.grossEarnings)).toBe(51630.43);
    // EPF wages still just capped Basic — overtime never touches it.
    expect(n(r.epf.wages)).toBe(15000);
    expect(n(r.epf.employeeContribution)).toBe(1800);
    // PT still off the 25000+ band, now computed on the overtime-inclusive gross.
    expect(n(r.professionalTax)).toBe(300);
    expect(n(r.netPay)).toBe(49530.43);
    expect(r.earnings.find((e) => e.code === 'OVERTIME')?.fullMonthlyAmount.toNumber()).toBe(
      1630.43,
    );
  });

  it('zero or omitted overtime hours add nothing', () => {
    const withZero = calculatePayroll(
      baseInput({ overtime: { hours: 0, hourlyRate: 100, multiplier: 2 } }),
    );
    const withNone = calculatePayroll(baseInput());
    expect(n(withZero.overtimePay)).toBe(0);
    expect(n(withZero.grossEarnings)).toBe(n(withNone.grossEarnings));
    expect(withZero.earnings.some((e) => e.code === 'OVERTIME')).toBe(false);
  });

  it('overtime pay is never prorated by LOP — a part-month employee still gets the full overtime amount', () => {
    const r = calculatePayroll(
      baseInput({
        workingDays: 20,
        payableDays: 18,
        overtime: { hours: 5, hourlyRate: 100, multiplier: 2 },
      }),
    );
    expect(n(r.overtimePay)).toBe(1000);
    // Base LOP case (no overtime) grossed 45000 (see the LOP describe block);
    // overtime adds its full 1000 on top, untouched by the 18/20 factor.
    expect(n(r.grossEarnings)).toBe(46000);
  });
});
