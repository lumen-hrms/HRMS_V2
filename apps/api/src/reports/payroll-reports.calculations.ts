/**
 * Pure calculations behind the payroll-backed reports (module 11, FR-RPT-002
 * and FR-RPT-004). Like reports.calculations.ts: no Prisma, no Nest — the
 * service loads rows from processed runs and hands them here.
 *
 * These reports only ever reformat Payroll's already-computed, immutable
 * numbers (module 07 INV-2); nothing here recomputes a deduction. Money is
 * summed with Decimal, never floats, and emitted as numbers rounded to 2dp
 * only at the table boundary.
 */
import { Prisma } from '@prisma/client';
import type { ReportTable } from './report-table';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;
type DecimalValue = Prisma.Decimal | number | string;

export interface PayrollLineSnapshot {
  period: string; // YYYY-MM
  employeeCode: string;
  employeeName: string;
  departmentName: string | null;
  pfNumber: string | null;
  uan: string | null;
  esicNumber: string | null;
  ctcAnnual: DecimalValue | null;
  workingDays: number;
  payableDays: number;
  lopDays: number;
  grossEarnings: DecimalValue;
  epfEmployee: DecimalValue;
  epfEmployer: DecimalValue;
  esiEmployee: DecimalValue;
  esiEmployer: DecimalValue;
  professionalTax: DecimalValue;
  tdsDeducted: DecimalValue;
  netPay: DecimalValue;
  /** The raw `calculationSnapshot` JSON (epf/esi sub-splits live here). */
  snapshot: unknown;
}

export interface GratuityRow {
  employeeCode: string;
  employeeName: string;
  departmentName: string | null;
  separationDate: Date;
  yearsOfService: number;
  amount: DecimalValue;
  status: string;
}

const D = (v: DecimalValue | null | undefined) => new Decimal(v ?? 0);
const num = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

/** Reads `snapshot.<group>.<field>` as a Decimal, 0 when absent/non-numeric. */
function snap(snapshot: unknown, group: 'epf' | 'esi', field: string): Decimal {
  const g = (snapshot as Record<string, unknown> | null)?.[group] as
    Record<string, unknown> | undefined;
  const raw = g?.[field];
  if (typeof raw === 'string' || typeof raw === 'number') {
    try {
      return new Decimal(raw);
    } catch {
      return new Decimal(0);
    }
  }
  return new Decimal(0);
}

const byCode = (a: PayrollLineSnapshot, b: PayrollLineSnapshot) =>
  a.employeeCode.localeCompare(b.employeeCode, undefined, { numeric: true });

// ---------------------------------------------------------------------------
// FR-RPT-002 — payroll cost, month by month
// ---------------------------------------------------------------------------

export function computePayrollCost(lines: PayrollLineSnapshot[], periods: string[]) {
  const rows = periods.map((period) => {
    const ls = lines.filter((l) => l.period === period);
    const sum = (f: (l: PayrollLineSnapshot) => DecimalValue) =>
      ls.reduce((s, l) => s.plus(D(f(l))), new Decimal(0));
    const gross = sum((l) => l.grossEarnings);
    const employerEpf = sum((l) => l.epfEmployer);
    const employerEsi = sum((l) => l.esiEmployer);
    const net = sum((l) => l.netPay);
    // Cost to company for the month = gross paid + employer-side statutory.
    const employerCost = gross.plus(employerEpf).plus(employerEsi);
    // Annual CTC is a plan figure; /12 is the like-for-like monthly comparison.
    const plannedCtc = ls.reduce((s, l) => s.plus(D(l.ctcAnnual).div(12)), new Decimal(0));
    return {
      period,
      employees: ls.length,
      gross: num(gross),
      employerEpf: num(employerEpf),
      employerEsi: num(employerEsi),
      employerCost: num(employerCost),
      netPay: num(net),
      plannedMonthlyCtc: num(plannedCtc),
      varianceToCtc: num(employerCost.minus(plannedCtc)),
    };
  });

  const depts = new Map<
    string,
    { employees: Set<string>; gross: Decimal; employerCost: Decimal }
  >();
  for (const l of lines) {
    const key = l.departmentName ?? 'Unassigned';
    const e = depts.get(key) ?? {
      employees: new Set<string>(),
      gross: new Decimal(0),
      employerCost: new Decimal(0),
    };
    e.employees.add(l.employeeCode);
    e.gross = e.gross.plus(D(l.grossEarnings));
    e.employerCost = e.employerCost
      .plus(D(l.grossEarnings))
      .plus(D(l.epfEmployer))
      .plus(D(l.esiEmployer));
    depts.set(key, e);
  }
  const byDepartment = [...depts.entries()]
    .map(([name, e]) => ({
      name,
      employees: e.employees.size,
      gross: num(e.gross),
      employerCost: num(e.employerCost),
    }))
    .sort((a, b) => b.employerCost - a.employerCost || a.name.localeCompare(b.name));

  const totalCost = rows.reduce((s, r) => s.plus(r.employerCost), new Decimal(0));
  const totalGross = rows.reduce((s, r) => s.plus(r.gross), new Decimal(0));
  const totalNet = rows.reduce((s, r) => s.plus(r.netPay), new Decimal(0));
  return {
    summary: {
      months: rows.filter((r) => r.employees > 0).length,
      totalGross: num(totalGross),
      totalEmployerCost: num(totalCost),
      totalNetPay: num(totalNet),
      byDepartment,
    },
    table: {
      columns: [
        { key: 'period', label: 'Month' },
        { key: 'employees', label: 'Employees paid' },
        { key: 'gross', label: 'Gross earnings' },
        { key: 'employerEpf', label: 'Employer EPF' },
        { key: 'employerEsi', label: 'Employer ESI' },
        { key: 'employerCost', label: 'Employer cost' },
        { key: 'netPay', label: 'Net pay' },
        { key: 'plannedMonthlyCtc', label: 'Planned CTC / 12' },
        { key: 'varianceToCtc', label: 'Cost vs CTC' },
      ],
      rows,
    } satisfies ReportTable,
  };
}

// ---------------------------------------------------------------------------
// FR-RPT-004 — statutory registers for one period
// ---------------------------------------------------------------------------

export function computeSalaryRegister(lines: PayrollLineSnapshot[], period: string) {
  const ls = lines.filter((l) => l.period === period).sort(byCode);
  const rows = ls.map((l) => ({
    employeeCode: l.employeeCode,
    name: l.employeeName,
    department: l.departmentName ?? 'Unassigned',
    payableDays: l.payableDays,
    lopDays: l.lopDays,
    gross: num(D(l.grossEarnings)),
    epfEmployee: num(D(l.epfEmployee)),
    esiEmployee: num(D(l.esiEmployee)),
    professionalTax: num(D(l.professionalTax)),
    tds: num(D(l.tdsDeducted)),
    netPay: num(D(l.netPay)),
  }));
  return registerResult(
    period,
    ls.length,
    rows,
    [
      { key: 'employeeCode', label: 'Emp code' },
      { key: 'name', label: 'Name' },
      { key: 'department', label: 'Department' },
      { key: 'payableDays', label: 'Payable days' },
      { key: 'lopDays', label: 'LOP days' },
      { key: 'gross', label: 'Gross' },
      { key: 'epfEmployee', label: 'EPF (employee)' },
      { key: 'esiEmployee', label: 'ESI (employee)' },
      { key: 'professionalTax', label: 'Prof. tax' },
      { key: 'tds', label: 'TDS' },
      { key: 'netPay', label: 'Net pay' },
    ],
    ['gross', 'epfEmployee', 'esiEmployee', 'professionalTax', 'tds', 'netPay'],
  );
}

export function computePfRegister(lines: PayrollLineSnapshot[], period: string) {
  const ls = lines.filter((l) => l.period === period).sort(byCode);
  const rows = ls
    .map((l) => {
      const eps = snap(l.snapshot, 'epf', 'epsContribution');
      const employerPf = snap(l.snapshot, 'epf', 'employerPfContribution');
      return {
        employeeCode: l.employeeCode,
        name: l.employeeName,
        uan: l.uan ?? '',
        pfNumber: l.pfNumber ?? '',
        epfWages: num(snap(l.snapshot, 'epf', 'wages')),
        employeeShare: num(D(l.epfEmployee)),
        epsShare: num(eps),
        employerPfShare: num(employerPf),
        adminCharge: num(snap(l.snapshot, 'epf', 'adminCharge')),
        edli: num(snap(l.snapshot, 'epf', 'edliContribution')),
      };
    })
    .filter((r) => r.employeeShare > 0 || r.epfWages > 0);
  return registerResult(
    period,
    rows.length,
    rows,
    [
      { key: 'employeeCode', label: 'Emp code' },
      { key: 'name', label: 'Name' },
      { key: 'uan', label: 'UAN' },
      { key: 'pfNumber', label: 'PF number' },
      { key: 'epfWages', label: 'EPF wages' },
      { key: 'employeeShare', label: 'Employee 12%' },
      { key: 'epsShare', label: 'EPS 8.33%' },
      { key: 'employerPfShare', label: 'Employer EPF' },
      { key: 'adminCharge', label: 'Admin charge' },
      { key: 'edli', label: 'EDLI' },
    ],
    ['epfWages', 'employeeShare', 'epsShare', 'employerPfShare', 'adminCharge', 'edli'],
  );
}

export function computeEsiRegister(lines: PayrollLineSnapshot[], period: string) {
  const ls = lines.filter((l) => l.period === period).sort(byCode);
  const rows = ls
    .filter((l) => snap(l.snapshot, 'esi', 'wages').gt(0) || D(l.esiEmployee).gt(0))
    .map((l) => ({
      employeeCode: l.employeeCode,
      name: l.employeeName,
      esicNumber: l.esicNumber ?? '',
      payableDays: l.payableDays,
      esiWages: num(snap(l.snapshot, 'esi', 'wages')),
      employeeShare: num(D(l.esiEmployee)),
      employerShare: num(D(l.esiEmployer)),
    }));
  return registerResult(
    period,
    rows.length,
    rows,
    [
      { key: 'employeeCode', label: 'Emp code' },
      { key: 'name', label: 'Name' },
      { key: 'esicNumber', label: 'ESIC number' },
      { key: 'payableDays', label: 'Payable days' },
      { key: 'esiWages', label: 'ESI wages' },
      { key: 'employeeShare', label: 'Employee 0.75%' },
      { key: 'employerShare', label: 'Employer 3.25%' },
    ],
    ['esiWages', 'employeeShare', 'employerShare'],
  );
}

export function computeGratuityRegister(rows: GratuityRow[], from: string, to: string) {
  const sorted = [...rows].sort((a, b) => a.separationDate.getTime() - b.separationDate.getTime());
  const out = sorted.map((r) => ({
    employeeCode: r.employeeCode,
    name: r.employeeName,
    department: r.departmentName ?? 'Unassigned',
    separationDate: r.separationDate.toISOString().slice(0, 10),
    yearsOfService: r.yearsOfService,
    gratuity: num(D(r.amount)),
    status: r.status,
  }));
  const total = out.reduce((s, r) => s.plus(r.gratuity), new Decimal(0));
  return {
    summary: { from, to, settlements: out.length, totalGratuity: num(total) },
    table: {
      columns: [
        { key: 'employeeCode', label: 'Emp code' },
        { key: 'name', label: 'Name' },
        { key: 'department', label: 'Department' },
        { key: 'separationDate', label: 'Separation date' },
        { key: 'yearsOfService', label: 'Years of service' },
        { key: 'gratuity', label: 'Gratuity' },
        { key: 'status', label: 'Settlement status' },
      ],
      rows: out,
    } satisfies ReportTable,
  };
}

function registerResult(
  period: string,
  employees: number,
  rows: Array<Record<string, string | number>>,
  columns: ReportTable['columns'],
  totalKeys: string[],
) {
  const totals: Record<string, number> = {};
  for (const k of totalKeys) {
    totals[k] = num(rows.reduce((s, r) => s.plus(D(r[k] as number)), new Decimal(0)));
  }
  const withTotal =
    rows.length === 0
      ? rows
      : [...rows, { [columns[0].key]: 'TOTAL', ...totals } as Record<string, string | number>];
  return {
    summary: { period, employees, totals },
    table: { columns, rows: withTotal } satisfies ReportTable,
  };
}

/** Months (YYYY-MM) covered by two ISO days, inclusive. */
export function periodsBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth();
  for (;;) {
    if (new Date(Date.UTC(y, m, 1)).getTime() > to.getTime()) break;
    out.push(`${y}-${String(m + 1).padStart(2, '0')}`);
    m += 1;
    if (m === 12) {
      m = 0;
      y += 1;
    }
  }
  return out;
}
