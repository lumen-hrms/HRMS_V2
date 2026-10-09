import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayrollRunService } from './payroll-run.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

const admin: AuthenticatedUser = {
  sub: 'admin-1',
  tenantId: 't1',
  role: 'COMPANY_ADMIN',
  email: 'a@x.com',
};
const hr: AuthenticatedUser = { sub: 'hr-1', tenantId: 't1', role: 'HR_MANAGER', email: 'h@x.com' };
const auditor: AuthenticatedUser = {
  sub: 'aud-1',
  tenantId: 't1',
  role: 'AUDITOR',
  email: 'd@x.com',
};
const employee: AuthenticatedUser = {
  sub: 'emp-1',
  tenantId: 't1',
  role: 'EMPLOYEE',
  email: 'e@x.com',
  employeeId: 'emp-1',
};

const DEFAULT_SETTINGS = {
  epfCeiling: 15000,
  allowEpfAboveCeiling: false,
  epfEmployeeRate: 12,
  epsRate: 8.33,
  epfEmployerRate: 3.67,
  epfAdminRate: 0.5,
  edliRate: 0.5,
  esiWageCeiling: 21000,
  esiEmployeeRate: 0.75,
  esiEmployerRate: 3.25,
  overtimeEnabled: false,
  overtimeMultiplier: 2,
};

const TENANT_SETTINGS = { weeklyOffDays: [0, 6] };

function activeEmployee(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    workState: 'KARNATAKA',
    weeklyOffDaysOverride: [],
    dateOfJoining: new Date('2020-01-01'),
    salaryStructures: [
      {
        ctcAnnual: new Prisma.Decimal(600000),
        components: [
          {
            type: 'BASIC',
            code: 'BASIC',
            calculationMode: 'FIXED',
            value: new Prisma.Decimal(30000),
            formula: null,
          },
          {
            type: 'HRA',
            code: 'HRA',
            calculationMode: 'PERCENT_OF_BASIC',
            value: new Prisma.Decimal(40),
            formula: null,
          },
        ],
      },
    ],
    ...over,
  };
}

function buildService(overrides: Record<string, any> = {}) {
  const client = {
    user: { count: jest.fn().mockResolvedValue(2) },
    payrollRun: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      create: jest.fn((args: any) => ({ id: args.data.id, ...args.data })),
      update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })),
    },
    payrollRunApproval: {
      upsert: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(1),
    },
    payrollLineItem: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })),
    },
    tenantSettings: { findUniqueOrThrow: jest.fn().mockResolvedValue(TENANT_SETTINGS) },
    employee: { findMany: jest.fn().mockResolvedValue([]) },
    regularizationRequest: { count: jest.fn().mockResolvedValue(0) },
    professionalTaxSlab: {
      findMany: jest.fn().mockResolvedValue([
        {
          state: 'KARNATAKA',
          grossFrom: new Prisma.Decimal(0),
          grossTo: new Prisma.Decimal(15000),
          monthlyAmount: new Prisma.Decimal(0),
        },
        {
          state: 'KARNATAKA',
          grossFrom: new Prisma.Decimal(15000),
          grossTo: null,
          monthlyAmount: new Prisma.Decimal(200),
        },
      ]),
    },
    holiday: { findMany: jest.fn().mockResolvedValue([]) },
    arrearsLineItem: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    ...overrides.client,
  };
  const tenantPrisma = {
    tenantId: 't1',
    client,
    transaction: jest.fn(async (build: (tx: typeof client) => unknown[]) =>
      Promise.all(build(client)),
    ),
  };
  const config = { getSettings: jest.fn().mockResolvedValue(DEFAULT_SETTINGS) };
  const attendance = {
    getLopDaysBatch: jest.fn().mockResolvedValue(new Map()),
    getApprovedOvertimeBatch: jest.fn().mockResolvedValue(new Map()),
    getShiftHours: jest.fn().mockResolvedValue(8),
  };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const storage = {
    buildKey: jest.fn(
      (tenantId: string, employeeId: string, filename: string, segment?: string) =>
        `tenants/${tenantId}/employees/${employeeId}/${segment ? `${segment}/` : ''}${filename}`,
    ),
    upload: jest.fn().mockResolvedValue(undefined),
    getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://storage.example/presigned'),
  };
  const fieldEncryption = { decrypt: jest.fn((v: string) => `plain:${v}`) };
  // Empty slabs -> zero projected tax -> tdsDeducted stays 0 for every
  // existing fixture, same as before Phase 6; TDS-specific tests below
  // override this with their own context.
  const tds = {
    buildContext: jest.fn(
      async (employeeIds: string[]) =>
        new Map(
          employeeIds.map((id) => [
            id,
            {
              regime: 'NEW' as const,
              slabs: [],
              config: {
                standardDeduction: 0,
                cessPercent: 0,
                rebateThreshold: 0,
                rebateMaxAmount: 0,
              },
              declaredExemptions: 0,
              elapsedGross: new Prisma.Decimal(0),
              alreadyDeducted: new Prisma.Decimal(0),
              remainingMonths: 12,
            },
          ]),
        ),
    ),
  };

  const service = new PayrollRunService(
    tenantPrisma as any,
    config as any,
    attendance as any,
    notifications as any,
    storage as any,
    fieldEncryption as any,
    tds as any,
  );
  return {
    service,
    client,
    tenantPrisma,
    config,
    attendance,
    notifications,
    storage,
    fieldEncryption,
    tds,
  };
}

describe('PayrollRunService.createDraft', () => {
  it('blocks creation below two active Company Admins (INV-4)', async () => {
    const { service, client } = buildService();
    client.user.count.mockResolvedValue(1);
    await expect(service.createDraft({ period: '2026-09' }, admin)).rejects.toThrow(
      ConflictException,
    );
  });

  it('rejects non-admin/HR roles', async () => {
    const { service } = buildService();
    await expect(service.createDraft({ period: '2026-09' }, employee)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects isReprocess without a reason', async () => {
    const { service } = buildService();
    await expect(
      service.createDraft({ period: '2026-09', isReprocess: true }, admin),
    ).rejects.toThrow(BadRequestException);
  });

  it('409s when a non-reprocess run already exists for the period', async () => {
    const { service, client } = buildService();
    client.payrollRun.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(service.createDraft({ period: '2026-09' }, admin)).rejects.toThrow(
      ConflictException,
    );
  });

  it('allows a reprocess even when a run already exists, given a reason', async () => {
    const { service, client } = buildService();
    client.payrollRun.findFirst.mockResolvedValue({ id: 'existing' });
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-2',
      status: 'DRAFT',
      period: '2026-09',
      exceptions: [],
    });
    await service.createDraft(
      { period: '2026-09', isReprocess: true, reprocessReason: 'Late revision' },
      admin,
    );
    expect(client.payrollRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isReprocess: true }) }),
    );
  });

  it('excludes an employee with no workState as an exception, not a line item', async () => {
    const { service, client } = buildService();
    client.employee.findMany.mockResolvedValue([activeEmployee('emp-1', { workState: null })]);
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'DRAFT',
      period: '2026-09',
      exceptions: [{ type: 'NO_WORK_STATE', employeeId: 'emp-1' }],
    });

    await service.createDraft({ period: '2026-09' }, admin);

    expect(client.payrollLineItem.createMany).not.toHaveBeenCalled();
    const created = client.payrollRun.create.mock.calls[0][0].data;
    expect(created.exceptions).toEqual([
      { employeeId: 'emp-1', type: 'NO_WORK_STATE', detail: 'No workState set' },
    ]);
  });

  it('excludes an employee with no active salary structure as an exception', async () => {
    const { service, client } = buildService();
    client.employee.findMany.mockResolvedValue([activeEmployee('emp-1', { salaryStructures: [] })]);
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'DRAFT',
      period: '2026-09',
      exceptions: [],
    });

    await service.createDraft({ period: '2026-09' }, admin);

    const created = client.payrollRun.create.mock.calls[0][0].data;
    expect(created.exceptions[0].type).toBe('NO_SALARY_STRUCTURE');
  });

  it('computes a correct line item for an eligible employee and includes it', async () => {
    const { service, client } = buildService();
    client.employee.findMany.mockResolvedValue([activeEmployee('emp-1')]);
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'DRAFT',
      period: '2026-09',
      exceptions: [],
    });

    await service.createDraft({ period: '2026-09' }, admin);

    expect(client.payrollLineItem.createMany).toHaveBeenCalledTimes(1);
    const data = client.payrollLineItem.createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(1);
    expect(data[0].employeeId).toBe('emp-1');
    // BASIC 30000 + HRA 12000 = 42000 gross, full month (September 2026: 22 working days).
    expect(data[0].grossEarnings.toNumber()).toBe(42000);
    expect(data[0].workingDays).toBe(22);
    expect(data[0].payableDays).toBe(22);
  });

  it('folds the TdsService-computed monthly TDS into tdsDeducted and netPay (module 07 Phase 6)', async () => {
    const { service, client, tds } = buildService();
    client.employee.findMany.mockResolvedValue([activeEmployee('emp-1')]);
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'DRAFT',
      period: '2026-09',
      exceptions: [],
    });
    // Flat 10% tax, no cess/rebate, no history: annualTax = 42000 x 12 x 10% =
    // 50,400; / 12 months = 4,200 TDS this month.
    tds.buildContext.mockResolvedValue(
      new Map([
        [
          'emp-1',
          {
            regime: 'NEW',
            slabs: [{ incomeFrom: 0, incomeTo: null, ratePercent: 10 }],
            config: {
              standardDeduction: 0,
              cessPercent: 0,
              rebateThreshold: 0,
              rebateMaxAmount: 0,
            },
            declaredExemptions: 0,
            elapsedGross: new Prisma.Decimal(0),
            alreadyDeducted: new Prisma.Decimal(0),
            remainingMonths: 12,
          },
        ],
      ]) as any,
    );

    await service.createDraft({ period: '2026-09' }, admin);

    expect(tds.buildContext).toHaveBeenCalledWith(['emp-1'], '2026-09');
    const data = client.payrollLineItem.createMany.mock.calls[0][0].data;
    expect(data[0].grossEarnings.toNumber()).toBe(42000); // gross is unaffected by TDS
    expect(data[0].tdsDeducted.toNumber()).toBe(4200);
    // base net (no TDS) is 40000 per the fixture above; TDS subtracts 4,200.
    expect(data[0].netPay.toNumber()).toBe(35800);
  });

  it('skips the TDS pass entirely (and the net-pay figure matches the no-TDS baseline) when the computed TDS is zero', async () => {
    const { service, client } = buildService(); // default fake tds context: empty slabs -> 0 tax
    client.employee.findMany.mockResolvedValue([activeEmployee('emp-1')]);
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'DRAFT',
      period: '2026-09',
      exceptions: [],
    });

    await service.createDraft({ period: '2026-09' }, admin);

    const data = client.payrollLineItem.createMany.mock.calls[0][0].data;
    expect(data[0].tdsDeducted.toNumber()).toBe(0);
    expect(data[0].netPay.toNumber()).toBe(40000);
  });

  it('folds a pending arrears row into adHocAdjustments and netPay, then marks it FOLDED (module 07 Phase 7)', async () => {
    const { service, client } = buildService();
    client.employee.findMany.mockResolvedValue([activeEmployee('emp-1')]);
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'DRAFT',
      period: '2026-09',
      exceptions: [],
    });
    client.arrearsLineItem.findMany.mockResolvedValue([
      { id: 'ar-1', employeeId: 'emp-1', period: '2026-07', amount: new Prisma.Decimal(5000) },
    ]);

    await service.createDraft({ period: '2026-09' }, admin);

    const runId = client.payrollRun.create.mock.calls[0][0].data.id;
    const data = client.payrollLineItem.createMany.mock.calls[0][0].data;
    expect(data[0].adHocAdjustments).toEqual([
      { type: 'ARREARS', amount: 5000, note: 'Salary revision arrears for 2026-07' },
    ]);
    expect(data[0].netPay.toNumber()).toBe(45000); // 40000 baseline + 5000 arrears
    expect(client.arrearsLineItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['ar-1'] } },
      data: { status: 'FOLDED', foldedIntoRunId: runId },
    });
  });

  it('sums several pending arrears rows (including a negative one) for the same employee', async () => {
    const { service, client } = buildService();
    client.employee.findMany.mockResolvedValue([activeEmployee('emp-1')]);
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'DRAFT',
      period: '2026-09',
      exceptions: [],
    });
    client.arrearsLineItem.findMany.mockResolvedValue([
      { id: 'ar-1', employeeId: 'emp-1', period: '2026-07', amount: new Prisma.Decimal(3000) },
      { id: 'ar-2', employeeId: 'emp-1', period: '2026-08', amount: new Prisma.Decimal(-1000) },
    ]);

    await service.createDraft({ period: '2026-09' }, admin);

    const data = client.payrollLineItem.createMany.mock.calls[0][0].data;
    expect(data[0].adHocAdjustments).toHaveLength(2);
    expect(data[0].netPay.toNumber()).toBe(42000); // 40000 + 3000 - 1000
    expect(client.arrearsLineItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['ar-1', 'ar-2'] } } }),
    );
  });

  it('does not touch arrearsLineItem.updateMany when there is nothing pending', async () => {
    const { service, client } = buildService(); // default: findMany resolves []
    client.employee.findMany.mockResolvedValue([activeEmployee('emp-1')]);
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'DRAFT',
      period: '2026-09',
      exceptions: [],
    });

    await service.createDraft({ period: '2026-09' }, admin);

    expect(client.arrearsLineItem.updateMany).not.toHaveBeenCalled();
    const data = client.payrollLineItem.createMany.mock.calls[0][0].data;
    expect(data[0].adHocAdjustments).toEqual([]);
  });

  it('wires approved overtime into the line item when the tenant has it enabled (module 07 Phase 4)', async () => {
    const { service, client, config, attendance } = buildService();
    config.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, overtimeEnabled: true });
    attendance.getApprovedOvertimeBatch.mockResolvedValue(new Map([['emp-1', 5]]));
    client.employee.findMany.mockResolvedValue([activeEmployee('emp-1')]);
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'DRAFT',
      period: '2026-09',
      exceptions: [],
    });

    await service.createDraft({ period: '2026-09' }, admin);

    const data = client.payrollLineItem.createMany.mock.calls[0][0].data;
    // BASIC 30000 + HRA 12000 = 42000 base gross, + 5h x (30000/(22x8)) x 2 overtime = 1704.55.
    expect(data[0].grossEarnings.toNumber()).toBe(43704.55);
    expect(data[0].calculationSnapshot.overtimePay).toBe(1704.55);
  });

  it('does not touch overtime at all when the tenant has it disabled, even with approved hours', async () => {
    const { service, client, attendance } = buildService();
    attendance.getApprovedOvertimeBatch.mockResolvedValue(new Map([['emp-1', 5]]));
    client.employee.findMany.mockResolvedValue([activeEmployee('emp-1')]);
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'DRAFT',
      period: '2026-09',
      exceptions: [],
    });

    await service.createDraft({ period: '2026-09' }, admin);

    const data = client.payrollLineItem.createMany.mock.calls[0][0].data;
    expect(data[0].grossEarnings.toNumber()).toBe(42000);
    expect(attendance.getShiftHours).not.toHaveBeenCalled();
  });

  it('flags pending regularizations as a non-blocking exception', async () => {
    const { service, client } = buildService();
    client.regularizationRequest.count.mockResolvedValue(3);
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'DRAFT',
      period: '2026-09',
      exceptions: [],
    });

    await service.createDraft({ period: '2026-09' }, admin);

    const created = client.payrollRun.create.mock.calls[0][0].data;
    expect(created.exceptions).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'PENDING_REGULARIZATIONS' })]),
    );
  });

  it('maps a unique-constraint race on create to a 409', async () => {
    const { service, client } = buildService();
    client.employee.findMany.mockResolvedValue([]);
    const error = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'x',
    });
    client.payrollRun.create.mockImplementation(() => {
      throw error;
    });
    await expect(service.createDraft({ period: '2026-09' }, admin)).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('PayrollRunService.approve', () => {
  it('records the first approval without advancing status', async () => {
    const { service, client } = buildService();
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'REVIEW',
      period: '2026-09',
    });
    client.payrollRunApproval.count.mockResolvedValue(1);

    await service.approve('run-1', admin);

    expect(client.payrollRun.update).not.toHaveBeenCalled();
  });

  it('advances to APPROVED once two distinct approvers exist (INV-1)', async () => {
    const { service, client, notifications } = buildService();
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'REVIEW',
      period: '2026-09',
    });
    client.payrollRunApproval.count.mockResolvedValue(2);

    await service.approve('run-1', hr);

    expect(client.payrollRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { status: 'APPROVED' },
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ context: { period: '2026-09', status: 'APPROVED' } }),
    );
  });

  it('the same account approving twice counts once (upsert, not a second row)', async () => {
    const { service, client } = buildService();
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'REVIEW',
      period: '2026-09',
    });
    client.payrollRunApproval.count.mockResolvedValue(1);

    await service.approve('run-1', admin);
    await service.approve('run-1', admin);

    expect(client.payrollRunApproval.upsert).toHaveBeenCalledTimes(2);
    expect(client.payrollRun.update).not.toHaveBeenCalled();
  });

  it('is blocked by the payroll gate too (INV-4)', async () => {
    const { service, client } = buildService();
    client.user.count.mockResolvedValue(1);
    await expect(service.approve('run-1', admin)).rejects.toThrow(ConflictException);
  });

  it('rejects approving a run that is not under REVIEW', async () => {
    const { service, client } = buildService();
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'DRAFT',
      period: '2026-09',
    });
    await expect(service.approve('run-1', admin)).rejects.toThrow(ConflictException);
  });
});

describe('PayrollRunService state transitions', () => {
  it('submitForReview moves DRAFT -> REVIEW and rejects any other starting state', async () => {
    const { service, client, notifications } = buildService();
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'DRAFT',
      period: '2026-09',
    });

    await service.submitForReview('run-1', admin);
    expect(client.payrollRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { status: 'REVIEW' },
    });
    expect(notifications.notify).toHaveBeenCalled();

    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'REVIEW',
      period: '2026-09',
    });
    await expect(service.submitForReview('run-1', admin)).rejects.toThrow(ConflictException);
  });

  it('process moves APPROVED -> PROCESSED and rejects any other starting state', async () => {
    const { service, client } = buildService();
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'APPROVED',
      period: '2026-09',
    });
    await service.process('run-1', admin);
    expect(client.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED' }) }),
    );

    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'REVIEW',
      period: '2026-09',
    });
    await expect(service.process('run-1', admin)).rejects.toThrow(ConflictException);
  });

  it('disburse moves PROCESSED -> DISBURSED and rejects any other starting state', async () => {
    const { service, client } = buildService();
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'PROCESSED',
      period: '2026-09',
    });
    await service.disburse('run-1', admin);
    expect(client.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DISBURSED' }) }),
    );

    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'DRAFT',
      period: '2026-09',
    });
    await expect(service.disburse('run-1', admin)).rejects.toThrow(ConflictException);
  });
});

describe('PayrollRunService.setLineItemAdjustments', () => {
  it('folds signed ad-hoc adjustments into net pay', async () => {
    const { service, client } = buildService();
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'REVIEW',
      period: '2026-09',
    });
    client.payrollLineItem.findUnique.mockResolvedValue({
      id: 'li-1',
      grossEarnings: new Prisma.Decimal(42000),
      epfEmployee: new Prisma.Decimal(1800),
      esiEmployee: new Prisma.Decimal(0),
      professionalTax: new Prisma.Decimal(200),
      tdsDeducted: new Prisma.Decimal(0),
    });

    await service.setLineItemAdjustments(
      'run-1',
      'emp-1',
      [
        { type: 'BONUS', amount: 5000 },
        { type: 'ADVANCE', amount: -1000 },
      ],
      admin,
    );

    const data = client.payrollLineItem.update.mock.calls[0][0].data;
    // base net = 42000 - 1800 - 0 - 200 - 0 = 40000; + 5000 - 1000 = 44000.
    expect(data.netPay.toNumber()).toBe(44000);
  });

  it('404s when the employee has no line item in this run', async () => {
    const { service, client } = buildService();
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'REVIEW',
      period: '2026-09',
    });
    client.payrollLineItem.findUnique.mockResolvedValue(null);
    await expect(service.setLineItemAdjustments('run-1', 'emp-1', [], admin)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects adjustments once the run is no longer DRAFT/REVIEW', async () => {
    const { service, client } = buildService();
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'PROCESSED',
      period: '2026-09',
    });
    await expect(service.setLineItemAdjustments('run-1', 'emp-1', [], admin)).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('PayrollRunService.recalculate', () => {
  it('recomputes amounts while preserving existing ad-hoc adjustments', async () => {
    const { service, client } = buildService();
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'REVIEW',
      period: '2026-09',
    });
    client.payrollLineItem.findMany.mockResolvedValue([
      { id: 'li-1', employeeId: 'emp-1', adHocAdjustments: [{ type: 'BONUS', amount: 5000 }] },
    ]);
    client.employee.findMany.mockResolvedValue([activeEmployee('emp-1')]);

    await service.recalculate('run-1', admin);

    expect(client.payrollLineItem.update).toHaveBeenCalledTimes(1);
    const data = client.payrollLineItem.update.mock.calls[0][0].data;
    // Unchanged inputs -> same base net as the create-draft fixture (no PT
    // charged here since gross 42000 sits in Karnataka's 15000+ band at
    // 200/mo) + the preserved 5000 bonus.
    expect(data.netPay.toNumber()).toBeGreaterThan(5000);
    expect(data).not.toHaveProperty('employeeId');
  });

  it('rejects recalculating a run that is not DRAFT/REVIEW', async () => {
    const { service, client } = buildService();
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'PROCESSED',
      period: '2026-09',
    });
    await expect(service.recalculate('run-1', admin)).rejects.toThrow(ConflictException);
  });

  it('aborts without partial updates if an employee referenced by a line item no longer exists', async () => {
    const { service, client } = buildService();
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'DRAFT',
      period: '2026-09',
    });
    client.payrollLineItem.findMany.mockResolvedValue([
      { id: 'li-1', employeeId: 'emp-ghost', adHocAdjustments: [] },
    ]);
    client.employee.findMany.mockResolvedValue([]);

    await expect(service.recalculate('run-1', admin)).rejects.toThrow(ConflictException);
    expect(client.payrollLineItem.update).not.toHaveBeenCalled();
  });
});

describe('PayrollRunService.getRun', () => {
  const runRow = {
    id: 'run-1',
    period: '2026-09',
    status: 'PROCESSED',
    isReprocess: false,
    reprocessReason: null,
    processedAt: new Date(),
    disbursedAt: null,
    exceptions: [{ type: 'NO_WORK_STATE' }],
    approvals: [{ approverId: 'admin-1', approvedAt: new Date() }],
    lineItems: [{ id: 'li-1', netPay: new Prisma.Decimal(40000) }],
  };

  it('gives HR/Admin the full run including line-item amounts', async () => {
    const { service, client } = buildService();
    client.payrollRun.findUnique.mockResolvedValue(runRow);
    const result: any = await service.getRun('run-1', admin);
    expect(result.lineItems[0].netPay).toBeDefined();
  });

  it('gives the Auditor a reduced view with no per-employee amounts (decision 9)', async () => {
    const { service, client } = buildService();
    client.payrollRun.findUnique.mockResolvedValue(runRow);
    const result: any = await service.getRun('run-1', auditor);
    expect(result.lineItems).toBeUndefined();
    expect(result.lineItemCount).toBe(1);
    expect(result.exceptionCount).toBe(1);
    expect(result.status).toBe('PROCESSED');
  });

  it('forbids an Employee from viewing any run', async () => {
    const { service, client } = buildService();
    client.payrollRun.findUnique.mockResolvedValue(runRow);
    await expect(service.getRun('run-1', employee)).rejects.toThrow(ForbiddenException);
  });

  it('404s for a run that does not exist', async () => {
    const { service, client } = buildService();
    client.payrollRun.findUnique.mockResolvedValue(null);
    await expect(service.getRun('nope', admin)).rejects.toThrow(NotFoundException);
  });
});

describe('PayrollRunService.process — payslip generation (module 07 Phase 5)', () => {
  const lineItem = {
    id: 'li-1',
    employeeId: 'emp-1',
    calculationSnapshot: { earnings: [{ code: 'BASIC', proratedAmount: 30000 }] },
    workingDays: 22,
    payableDays: 22,
    lopDays: 0,
    grossEarnings: new Prisma.Decimal(42000),
    epfEmployee: new Prisma.Decimal(1800),
    esiEmployee: new Prisma.Decimal(0),
    professionalTax: new Prisma.Decimal(200),
    tdsDeducted: new Prisma.Decimal(0),
    adHocAdjustments: [],
    netPay: new Prisma.Decimal(40000),
  };

  it('generates and uploads a payslip, and stamps payslipFileKey, for an employee with a DOB', async () => {
    const { service, client, storage, notifications } = buildService();
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'APPROVED',
      period: '2026-09',
      exceptions: [],
    });
    client.payrollLineItem.findMany.mockResolvedValue([lineItem]);
    client.employee.findMany.mockResolvedValue([
      {
        id: 'emp-1',
        firstName: 'Asha',
        lastName: 'Rao',
        employeeCode: 'E001',
        dateOfBirth: new Date('1990-05-15'),
      },
    ]);

    await service.process('run-1', admin);

    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(storage.upload.mock.calls[0][0]).toContain('emp-1');
    expect(storage.upload.mock.calls[0][2]).toBe('application/pdf');
    expect(client.payrollLineItem.update).toHaveBeenCalledWith({
      where: { id: 'li-1' },
      data: { payslipFileKey: expect.stringContaining('payslip') },
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'PAYSLIP_READY',
        to: { employeeIds: ['emp-1'] },
      }),
    );
  });

  it('excludes an employee with no dateOfBirth from payslip generation and lists an exception', async () => {
    const { service, client, storage } = buildService();
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'APPROVED',
      period: '2026-09',
      exceptions: [],
    });
    client.payrollLineItem.findMany.mockResolvedValue([lineItem]);
    client.employee.findMany.mockResolvedValue([
      { id: 'emp-1', firstName: 'Asha', lastName: 'Rao', employeeCode: 'E001', dateOfBirth: null },
    ]);

    await service.process('run-1', admin);

    expect(storage.upload).not.toHaveBeenCalled();
    expect(client.payrollLineItem.update).not.toHaveBeenCalled();
    const runUpdate = client.payrollRun.update.mock.calls[0][0];
    expect(runUpdate.data.exceptions).toEqual([
      {
        employeeId: 'emp-1',
        type: 'NO_DOB_FOR_PAYSLIP',
        detail: 'No dateOfBirth on file — payslip not generated',
      },
    ]);
  });
});

describe('PayrollRunService.getPayslipDownloadUrl', () => {
  const run = { id: 'run-1', period: '2026-09', status: 'PROCESSED' };
  const item = { payslipFileKey: 'tenants/t1/employees/emp-1/payslip/payslip-2026-09.pdf' };

  it('lets an employee download their own payslip', async () => {
    const { service, client, storage } = buildService();
    client.payrollRun.findFirst.mockResolvedValue(run);
    client.payrollLineItem.findUnique.mockResolvedValue(item);

    const result = await service.getPayslipDownloadUrl('emp-1', '2026-09', employee);

    expect(result.url).toBe('https://storage.example/presigned');
    expect(storage.getPresignedDownloadUrl).toHaveBeenCalledWith(
      item.payslipFileKey,
      300,
      'payslip-2026-09.pdf',
    );
  });

  it('forbids an employee from downloading someone elses payslip', async () => {
    const { service } = buildService();
    await expect(
      service.getPayslipDownloadUrl('someone-else', '2026-09', employee),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lets HR/Admin download any employees payslip', async () => {
    const { service, client } = buildService();
    client.payrollRun.findFirst.mockResolvedValue(run);
    client.payrollLineItem.findUnique.mockResolvedValue(item);
    const result = await service.getPayslipDownloadUrl('emp-1', '2026-09', admin);
    expect(result.url).toBeDefined();
  });

  it('404s when no processed run exists for the period', async () => {
    const { service, client } = buildService();
    client.payrollRun.findFirst.mockResolvedValue(null);
    await expect(service.getPayslipDownloadUrl('emp-1', '2026-09', admin)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('404s when the employee was excluded from payslip generation (no DOB)', async () => {
    const { service, client } = buildService();
    client.payrollRun.findFirst.mockResolvedValue(run);
    client.payrollLineItem.findUnique.mockResolvedValue({ payslipFileKey: null });
    await expect(service.getPayslipDownloadUrl('emp-1', '2026-09', admin)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('PayrollRunService.getBankFile', () => {
  it('generates a CSV with decrypted account numbers for employees with bank details', async () => {
    const { service, client, fieldEncryption } = buildService();
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'PROCESSED',
      period: '2026-09',
    });
    client.payrollLineItem.findMany.mockResolvedValue([
      { employeeId: 'emp-1', netPay: new Prisma.Decimal(40000) },
    ]);
    client.employee.findMany.mockResolvedValue([
      {
        id: 'emp-1',
        firstName: 'Asha',
        lastName: 'Rao',
        employeeCode: 'E001',
        bankAccountCiphertext: 'cipher-abc',
        bankIfsc: 'HDFC0001234',
        bankName: 'HDFC Bank',
      },
    ]);

    const result = await service.getBankFile('run-1', 'CSV', admin);

    expect(fieldEncryption.decrypt).toHaveBeenCalledWith('cipher-abc');
    expect(result.mimeType).toBe('text/csv');
    expect(result.filename).toBe('bank-file-2026-09.csv');
    expect(result.content).toContain('plain:cipher-abc');
    expect(result.content).toContain('40000.00');
    expect(result.skippedEmployeeCount).toBe(0);
  });

  it('skips employees missing bank account details and reports the count', async () => {
    const { service, client } = buildService();
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'PROCESSED',
      period: '2026-09',
    });
    client.payrollLineItem.findMany.mockResolvedValue([
      { employeeId: 'emp-1', netPay: new Prisma.Decimal(40000) },
    ]);
    client.employee.findMany.mockResolvedValue([
      {
        id: 'emp-1',
        firstName: 'Asha',
        lastName: 'Rao',
        employeeCode: 'E001',
        bankAccountCiphertext: null,
        bankIfsc: null,
        bankName: null,
      },
    ]);

    const result = await service.getBankFile('run-1', 'CSV', admin);
    expect(result.skippedEmployeeCount).toBe(1);
    expect(result.content.split('\n')).toHaveLength(2); // header + trailing newline only
  });

  it('rejects an unimplemented bank format', async () => {
    const { service, client } = buildService();
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'PROCESSED',
      period: '2026-09',
    });
    await expect(service.getBankFile('run-1', 'HDFC', admin)).rejects.toThrow(BadRequestException);
  });

  it('rejects generating a bank file before the run is PROCESSED', async () => {
    const { service, client } = buildService();
    client.payrollRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'APPROVED',
      period: '2026-09',
    });
    await expect(service.getBankFile('run-1', 'CSV', admin)).rejects.toThrow(ConflictException);
  });

  it('rejects non-admin/HR roles', async () => {
    const { service } = buildService();
    await expect(service.getBankFile('run-1', 'CSV', employee)).rejects.toThrow(ForbiddenException);
  });
});
