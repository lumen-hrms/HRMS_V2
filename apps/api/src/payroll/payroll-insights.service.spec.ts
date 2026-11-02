import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PayrollInsightsService, previousPeriod } from './payroll-insights.service';

const admin = { sub: 'u-admin', role: 'COMPANY_ADMIN' } as AuthenticatedUser;
const employee = { sub: 'u-emp', role: 'EMPLOYEE' } as AuthenticatedUser;
const D = (n: number) => new Prisma.Decimal(n);

function build() {
  const client: any = {
    payrollRun: { findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
    payrollLineItem: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
    employee: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    regularizationRequest: { count: jest.fn().mockResolvedValue(0) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const tenantPrisma: any = { client, tenantId: 't1' };
  return { service: new PayrollInsightsService(tenantPrisma), client };
}

const run = {
  id: 'run-1',
  period: '2026-11',
  status: 'REVIEW',
  isReprocess: false,
  reprocessReason: null,
  preparedBy: 'u-admin',
  exceptions: [{ employeeId: 'e2', type: 'NO_WORK_STATE', detail: 'x' }],
  createdAt: new Date(),
  processedAt: null,
  disbursedAt: null,
  approvals: [{ approverId: 'u-admin', approvedAt: new Date() }],
};

const item = (employeeId: string, gross: number, net: number, extra: object = {}) => ({
  id: `li-${employeeId}`,
  employeeId,
  workingDays: 22,
  payableDays: 22,
  lopDays: 0,
  grossEarnings: D(gross),
  epfEmployee: D(1800),
  epfEmployer: D(1800),
  esiEmployee: D(0),
  esiEmployer: D(0),
  professionalTax: D(200),
  tdsDeducted: D(0),
  netPay: D(net),
  adHocAdjustments: [],
  payslipFileKey: null,
  ...extra,
});

describe('previousPeriod', () => {
  it('handles a year boundary', () => {
    expect(previousPeriod('2026-01')).toBe('2025-12');
    expect(previousPeriod('2026-11')).toBe('2026-10');
  });
});

describe('PayrollInsightsService.getRunSummary', () => {
  it('totals the run, names the approvers and compares with last month', async () => {
    const { service, client } = build();
    client.payrollRun.findUnique.mockResolvedValue(run);
    client.payrollRun.findFirst.mockResolvedValue({ id: 'prev', period: '2026-10' });
    client.payrollLineItem.findMany.mockImplementation(({ where }: any) =>
      where.runId === 'prev'
        ? [item('e1', 40000, 35000)]
        : [item('e1', 50000, 44000), item('e2', 30000, 27000)],
    );
    client.employee.findMany.mockResolvedValue([
      { id: 'e1', department: { name: 'Ops' } },
      { id: 'e2', department: null },
    ]);
    client.user.findMany.mockResolvedValue([
      { id: 'u-admin', email: 'a@x.com', employee: { firstName: 'Ani', lastName: 'G' } },
    ]);
    const r = await service.getRunSummary('run-1');
    expect(r.totals).toMatchObject({ headcount: 2, gross: '80000.00', net: '71000.00' });
    expect(r.totals.employerCost).toBe('83600.00');
    expect(r.previous).toMatchObject({ period: '2026-10', headcount: 1, net: '35000.00' });
    expect(r.approvals[0].approverName).toBe('Ani G');
    expect(r.departments.map((d) => d.name)).toEqual(['Ops', 'No department']);
  });

  it('404s for an unknown run', async () => {
    const { service } = build();
    await expect(service.getRunSummary('nope')).rejects.toThrow(NotFoundException);
  });
});

describe('PayrollInsightsService.listLineItems', () => {
  function setup() {
    const ctx = build();
    ctx.client.payrollRun.findUnique.mockResolvedValue(run);
    ctx.client.payrollRun.findFirst.mockResolvedValue({ id: 'prev', period: '2026-10' });
    ctx.client.payrollLineItem.findMany.mockImplementation(({ where }: any) =>
      where.runId === 'prev'
        ? [
            { employeeId: 'e1', netPay: D(40000) },
            { employeeId: 'e2', netPay: D(27000) },
          ]
        : [item('e1', 50000, 44000), item('e2', 30000, 27000)],
    );
    ctx.client.employee.findMany.mockResolvedValue([
      {
        id: 'e1',
        employeeCode: 'E-1',
        firstName: 'Asha',
        lastName: 'Rao',
        designation: 'Nurse',
        department: { name: 'Clinical' },
      },
      {
        id: 'e2',
        employeeCode: 'E-2',
        firstName: 'Bob',
        lastName: 'Lee',
        designation: null,
        department: { name: 'Ops' },
      },
    ]);
    return ctx;
  }

  it('resolves names and computes change vs last month', async () => {
    const { service } = setup();
    const r = await service.listLineItems('run-1', {});
    expect(r.total).toBe(2);
    expect(r.items[0].employee?.name).toBe('Asha Rao');
    expect(r.items[0].changePct).toBe(10);
    expect(r.items[1].changePct).toBe(0);
    expect(r.items[1].exceptionTypes).toEqual(['NO_WORK_STATE']);
    expect(r.items[0].payslipReady).toBe(false);
  });

  it('searches, filters and paginates', async () => {
    const { service } = setup();
    expect(
      (await service.listLineItems('run-1', { search: 'bob' })).items.map((i) => i.employeeId),
    ).toEqual(['e2']);
    expect((await service.listLineItems('run-1', { department: 'Clinical' })).total).toBe(1);
    expect((await service.listLineItems('run-1', { hasException: true })).total).toBe(1);
    expect((await service.listLineItems('run-1', { changedOver: 5 })).total).toBe(1);
    const page = await service.listLineItems('run-1', {
      page: 2,
      pageSize: 1,
      sort: 'net',
      dir: 'desc',
    });
    expect(page.items.map((i) => i.employeeId)).toEqual(['e2']);
    expect(page.total).toBe(2);
  });

  it('never returns the calculation snapshot in the list', async () => {
    const { service, client } = setup();
    await service.listLineItems('run-1', {});
    const select = client.payrollLineItem.findMany.mock.calls.find(
      (c: any) => c[0].where.runId === 'run-1',
    )[0].select;
    expect(select.calculationSnapshot).toBeUndefined();
  });
});

describe('PayrollInsightsService.getReadiness', () => {
  it('groups blockers and warnings with counts', async () => {
    const { service, client } = build();
    client.employee.findMany.mockResolvedValue([
      {
        id: 'a',
        employeeCode: 'A',
        firstName: 'A',
        lastName: 'A',
        workState: null,
        dateOfBirth: null,
        bankAccountCiphertext: null,
        bankIfsc: null,
        salaryStructures: [],
      },
      {
        id: 'b',
        employeeCode: 'B',
        firstName: 'B',
        lastName: 'B',
        workState: 'KARNATAKA',
        dateOfBirth: new Date(),
        bankAccountCiphertext: 'x',
        bankIfsc: 'HDFC0001',
        salaryStructures: [{ id: 's' }],
      },
    ]);
    client.regularizationRequest.count.mockResolvedValue(3);
    client.payrollRun.findFirst.mockResolvedValue({ id: 'r', status: 'DRAFT' });
    const r = await service.getReadiness('2026-11');
    expect(r.eligibleCount).toBe(2);
    expect(r.blockers.map((g) => [g.type, g.count])).toEqual([
      ['NO_WORK_STATE', 1],
      ['NO_SALARY_STRUCTURE', 1],
    ]);
    expect(r.warnings.map((g) => g.type)).toEqual(['NO_DOB', 'NO_BANK']);
    expect(r.pendingRegularizations).toBe(3);
    expect(r.existingRun).toEqual({ id: 'r', status: 'DRAFT' });
  });

  it('is clean when everyone is ready', async () => {
    const { service, client } = build();
    client.employee.findMany.mockResolvedValue([
      {
        id: 'b',
        employeeCode: 'B',
        firstName: 'B',
        lastName: 'B',
        workState: 'KARNATAKA',
        dateOfBirth: new Date(),
        bankAccountCiphertext: 'x',
        bankIfsc: 'H',
        salaryStructures: [{ id: 's' }],
      },
    ]);
    const r = await service.getReadiness('2026-11');
    expect(r.blockers).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});

describe('PayrollInsightsService.bulkSetWorkState', () => {
  it('updates the employees and audits without per-employee data', async () => {
    const { service, client } = build();
    client.employee.updateMany.mockResolvedValue({ count: 2 });
    const r = await service.bulkSetWorkState(['a', 'b'], 'KARNATAKA' as any, admin);
    expect(r).toEqual({ updated: 2 });
    expect(client.employee.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] } },
      data: { workState: 'KARNATAKA' },
    });
    expect(client.auditLog.create).toHaveBeenCalled();
  });

  it('refuses a non-payroll role', async () => {
    const { service, client } = build();
    await expect(service.bulkSetWorkState(['a'], 'KARNATAKA' as any, employee)).rejects.toThrow(
      ForbiddenException,
    );
    expect(client.employee.updateMany).not.toHaveBeenCalled();
  });
});
