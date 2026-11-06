import {
  computeEsiRegister,
  computeGratuityRegister,
  computePayrollCost,
  computePfRegister,
  computeSalaryRegister,
  periodsBetween,
  PayrollLineSnapshot,
} from './payroll-reports.calculations';

function line(over: Partial<PayrollLineSnapshot> = {}): PayrollLineSnapshot {
  return {
    period: '2026-09',
    employeeCode: 'E001',
    employeeName: 'Asha Rao',
    departmentName: 'Engineering',
    pfNumber: 'PF/1',
    uan: '100000000001',
    esicNumber: null,
    ctcAnnual: '1200000',
    workingDays: 26,
    payableDays: 26,
    lopDays: 0,
    grossEarnings: '100000.00',
    epfEmployee: '1800.00',
    epfEmployer: '1800.00',
    esiEmployee: '0',
    esiEmployer: '0',
    professionalTax: '200.00',
    tdsDeducted: '5000.00',
    netPay: '93000.00',
    snapshot: {
      epf: {
        wages: '15000.00',
        employeeContribution: '1800.00',
        epsContribution: '1250.00',
        employerPfContribution: '550.00',
        adminCharge: '75.00',
        edliContribution: '75.00',
      },
      esi: { applicable: false, wages: '0', employeeContribution: '0', employerContribution: '0' },
    },
    ...over,
  };
}

describe('payroll report calculations', () => {
  it('periodsBetween lists whole months inclusive', () => {
    expect(
      periodsBetween(new Date('2026-08-15T00:00:00Z'), new Date('2026-10-02T00:00:00Z')),
    ).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  describe('payroll cost', () => {
    it('sums employer cost per month with exact decimals and flags empty months', () => {
      const lines = [
        line({ grossEarnings: '100000.10', epfEmployer: '1800.20', esiEmployer: '0.30' }),
        line({
          employeeCode: 'E002',
          grossEarnings: '50000.20',
          epfEmployer: '1800.00',
          esiEmployer: '0',
        }),
      ];
      const r = computePayrollCost(lines, ['2026-08', '2026-09']);
      const aug = r.table.rows[0];
      const sep = r.table.rows[1];
      expect(aug.employees).toBe(0);
      expect(sep.gross).toBe(150000.3);
      expect(sep.employerCost).toBe(153600.8);
      // planned CTC/12 = 2 x 100000
      expect(sep.plannedMonthlyCtc).toBe(200000);
      expect(sep.varianceToCtc).toBe(-46399.2);
      expect(r.summary.months).toBe(1);
      expect(r.summary.totalEmployerCost).toBe(153600.8);
    });

    it('groups by department, unassigned included', () => {
      const r = computePayrollCost(
        [line(), line({ employeeCode: 'E002', departmentName: null })],
        ['2026-09'],
      );
      expect(r.summary.byDepartment.map((d) => d.name).sort()).toEqual([
        'Engineering',
        'Unassigned',
      ]);
    });
  });

  describe('registers', () => {
    it('salary register sorts by employee code and appends totals', () => {
      const r = computeSalaryRegister(
        [line({ employeeCode: 'E010' }), line({ employeeCode: 'E002', netPay: '10.50' })],
        '2026-09',
      );
      expect(r.table.rows.map((x) => x.employeeCode)).toEqual(['E002', 'E010', 'TOTAL']);
      expect(r.summary.totals.netPay).toBe(93010.5);
    });

    it('ignores other periods', () => {
      const r = computeSalaryRegister([line({ period: '2026-08' })], '2026-09');
      expect(r.table.rows).toEqual([]);
    });

    it('PF register reads the EPF split from the snapshot and omits non-members', () => {
      const r = computePfRegister(
        [
          line(),
          line({
            employeeCode: 'E002',
            epfEmployee: '0',
            snapshot: { epf: { wages: '0' }, esi: {} },
          }),
        ],
        '2026-09',
      );
      expect(r.summary.employees).toBe(1);
      const row = r.table.rows[0];
      expect(row.epfWages).toBe(15000);
      expect(row.epsShare).toBe(1250);
      expect(row.employerPfShare).toBe(550);
      expect(r.summary.totals.adminCharge).toBe(75);
    });

    it('PF register tolerates a malformed snapshot', () => {
      const r = computePfRegister([line({ snapshot: null, epfEmployee: '10' })], '2026-09');
      expect(r.table.rows[0].epfWages).toBe(0);
    });

    it('ESI register only lists covered employees', () => {
      const covered = line({
        employeeCode: 'E003',
        esicNumber: 'ESI9',
        esiEmployee: '75.00',
        esiEmployer: '325.00',
        snapshot: { epf: {}, esi: { applicable: true, wages: '10000.00' } },
      });
      const r = computeEsiRegister([line(), covered], '2026-09');
      expect(r.summary.employees).toBe(1);
      expect(r.summary.totals.employerShare).toBe(325);
      expect(r.table.rows[0].esicNumber).toBe('ESI9');
    });

    it('gratuity register totals settlements ordered by separation date', () => {
      const r = computeGratuityRegister(
        [
          {
            employeeCode: 'E2',
            employeeName: 'B',
            departmentName: null,
            separationDate: new Date('2026-09-10T00:00:00Z'),
            yearsOfService: 6,
            amount: '50000.50',
            status: 'PAID',
          },
          {
            employeeCode: 'E1',
            employeeName: 'A',
            departmentName: 'Ops',
            separationDate: new Date('2026-08-01T00:00:00Z'),
            yearsOfService: 8,
            amount: '70000',
            status: 'APPROVED',
          },
        ],
        '2026-08-01',
        '2026-09-30',
      );
      expect(r.table.rows.map((x) => x.employeeCode)).toEqual(['E1', 'E2']);
      expect(r.summary.totalGratuity).toBe(120000.5);
    });
  });
});
