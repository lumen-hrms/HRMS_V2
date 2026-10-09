import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FullAndFinalService } from './full-and-final.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

const admin: AuthenticatedUser = {
  sub: 'admin-1',
  tenantId: 't1',
  role: 'COMPANY_ADMIN',
  email: 'a@x.com',
};
const employee: AuthenticatedUser = {
  sub: 'u-emp-1',
  tenantId: 't1',
  role: 'EMPLOYEE',
  email: 'e@x.com',
  employeeId: 'emp-1',
};
const otherEmployee: AuthenticatedUser = {
  sub: 'u-emp-2',
  tenantId: 't1',
  role: 'EMPLOYEE',
  email: 'e2@x.com',
  employeeId: 'emp-2',
};
const auditor: AuthenticatedUser = {
  sub: 'aud-1',
  tenantId: 't1',
  role: 'AUDITOR',
  email: 'd@x.com',
};

const SETTINGS = {
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
  leaveEncashmentDivisor: 26,
  leaveEncashmentComponents: ['BASIC'],
  gratuityEligibilityYears: 5,
  gratuityDaysPerYear: 15,
  gratuityMonthDivisor: 26,
};

function separatedEmployee(over: Record<string, unknown> = {}) {
  return {
    id: 'emp-1',
    workState: 'KARNATAKA',
    weeklyOffDaysOverride: [],
    lifecycleState: 'SEPARATED',
    lastWorkingDate: new Date('2026-09-15'),
    dateOfJoining: new Date('2020-09-15'), // exactly 6 completed years at separation
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

function build(over: { employee?: unknown; settings?: unknown } = {}) {
  // `generate()` ends by calling `get()`, which re-reads via `findUnique` —
  // stash what `create()` wrote so that re-read sees it, same as a real DB.
  let created: Record<string, unknown> | undefined;
  const client = {
    user: { count: jest.fn().mockResolvedValue(2) },
    fullAndFinalSettlement: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(created ?? null)),
      create: jest.fn((args: any) => {
        created = { ...args.data };
        return created;
      }),
      update: jest.fn((args: any) => ({ employeeId: args.where.employeeId, ...args.data })),
    },
    employee: {
      findUnique: jest
        .fn()
        .mockResolvedValue('employee' in over ? over.employee : separatedEmployee()),
    },
    tenantSettings: { findUniqueOrThrow: jest.fn().mockResolvedValue({ weeklyOffDays: [0, 6] }) },
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
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const tenantPrisma = { tenantId: 't1', client };
  const config = { getSettings: jest.fn().mockResolvedValue(over.settings ?? SETTINGS) };
  const attendance = { getLopDays: jest.fn().mockResolvedValue(0) };
  const leave = { getEncashableBalance: jest.fn().mockResolvedValue(10) };

  const service = new FullAndFinalService(
    tenantPrisma as any,
    config as any,
    attendance as any,
    leave as any,
  );
  return { service, client, tenantPrisma, config, attendance, leave };
}

describe('FullAndFinalService.generate', () => {
  it('computes unpaid salary, leave encashment, and gratuity, and stores a DRAFT settlement', async () => {
    const { service, client } = build();

    await service.generate('emp-1', {}, admin);

    expect(client.fullAndFinalSettlement.create).toHaveBeenCalledTimes(1);
    const data = client.fullAndFinalSettlement.create.mock.calls[0][0].data;
    // September 2026: 22 working days full month, 11 working days Sep 1-15
    // (separation on the 15th). payableFactor = 11/22 = 0.5.
    // Gross (full) = 30,000 Basic + 12,000 HRA (40% of Basic) = 42,000;
    // prorated = 21,000. EPF wages = 15,000 (ceiling) x 12% = 1,800. ESI:
    // full gross 42,000 > 21,000 ceiling -> not applicable. PT (Karnataka,
    // prorated gross 21,000 >= 15,000 band) = 200.
    // unpaidSalaryAmount = 21,000 - 1,800 - 200 = 19,000.
    expect(data.unpaidSalaryDays).toBe(11);
    expect(data.unpaidSalaryAmount.toNumber()).toBe(19000);

    // Leave: 10 encashable days x (30,000 Basic / 26) = 11,538.4615... -> 11,538.46.
    expect(data.leaveEncashmentDays.toNumber?.() ?? data.leaveEncashmentDays).toBe(10);
    expect(data.leaveEncashmentAmount.toNumber()).toBe(11538.46);

    // Gratuity: 6 completed years (2020-09-15 -> 2026-09-15, exact anniversary),
    // eligible (>= 5); 30,000 x 15 / 26 x 6 = 103,846.1538... -> 103,846.15.
    expect(data.gratuityYearsOfService).toBe(6);
    expect(data.gratuityAmount.toNumber()).toBe(103846.15);

    expect(data.advanceRecoveryAmount.toNumber()).toBe(0);
    // netSettlement = 19,000 + 11,538.46 + 103,846.15 - 0 = 134,384.61.
    expect(data.netSettlement.toNumber()).toBe(134384.61);
    expect(data.status).toBe('DRAFT');
    expect(data.preparedBy).toBe('admin-1');
  });

  it('subtracts a provided advanceRecoveryAmount from netSettlement', async () => {
    const { service, client } = build();
    await service.generate('emp-1', { advanceRecoveryAmount: 5000 }, admin);
    const data = client.fullAndFinalSettlement.create.mock.calls[0][0].data;
    expect(data.advanceRecoveryAmount.toNumber()).toBe(5000);
    expect(data.netSettlement.toNumber()).toBe(129384.61);
  });

  it('rejects a non-HR/Admin caller', async () => {
    const { service } = build();
    await expect(service.generate('emp-1', {}, employee)).rejects.toThrow(ForbiddenException);
  });

  it('is blocked by the payroll gate (INV-4)', async () => {
    const { service, client } = build();
    client.user.count.mockResolvedValue(1);
    await expect(service.generate('emp-1', {}, admin)).rejects.toThrow(ConflictException);
  });

  it('409s when a settlement already exists for this employee', async () => {
    const { service, client } = build();
    client.fullAndFinalSettlement.findUnique.mockResolvedValue({ employeeId: 'emp-1' });
    await expect(service.generate('emp-1', {}, admin)).rejects.toThrow(ConflictException);
  });

  it('rejects an employee who is not SEPARATED', async () => {
    const { service } = build({ employee: separatedEmployee({ lifecycleState: 'CONFIRMED' }) });
    await expect(service.generate('emp-1', {}, admin)).rejects.toThrow(ConflictException);
  });

  it('rejects an employee with no lastWorkingDate on file', async () => {
    const { service } = build({ employee: separatedEmployee({ lastWorkingDate: null }) });
    await expect(service.generate('emp-1', {}, admin)).rejects.toThrow(ConflictException);
  });

  it('rejects an employee with no dateOfJoining on file (gratuity needs it)', async () => {
    const { service } = build({ employee: separatedEmployee({ dateOfJoining: null }) });
    await expect(service.generate('emp-1', {}, admin)).rejects.toThrow(BadRequestException);
  });

  it('rejects an employee with no active salary structure', async () => {
    const { service } = build({ employee: separatedEmployee({ salaryStructures: [] }) });
    await expect(service.generate('emp-1', {}, admin)).rejects.toThrow(ConflictException);
  });

  it('pays no gratuity below the eligibility threshold', async () => {
    const { service, client } = build({
      employee: separatedEmployee({ dateOfJoining: new Date('2023-01-01') }), // < 5 years
    });
    await service.generate('emp-1', {}, admin);
    const data = client.fullAndFinalSettlement.create.mock.calls[0][0].data;
    expect(data.gratuityAmount.toNumber()).toBe(0);
  });
});

describe('FullAndFinalService.get', () => {
  it('lets the employee read their own settlement in full', async () => {
    const { service, client } = build();
    client.fullAndFinalSettlement.findUnique.mockResolvedValue({
      employeeId: 'emp-1',
      status: 'DRAFT',
      netSettlement: new Prisma.Decimal(134384.61),
    });
    const result = await service.get('emp-1', employee);
    expect(result).toMatchObject({ employeeId: 'emp-1' });
    expect((result as any).netSettlement).toBeDefined();
  });

  it('forbids an employee from reading someone elses settlement', async () => {
    const { service } = build();
    await expect(service.get('emp-1', otherEmployee)).rejects.toThrow(ForbiddenException);
  });

  it('gives the Auditor a reduced view with no amounts (decision 9)', async () => {
    const { service, client } = build();
    client.fullAndFinalSettlement.findUnique.mockResolvedValue({
      employeeId: 'emp-1',
      separationDate: new Date('2026-09-15'),
      status: 'APPROVED',
      approvedAt: new Date('2026-09-20'),
      paidAt: null,
      netSettlement: new Prisma.Decimal(134384.61),
    });
    const result = await service.get('emp-1', auditor);
    expect(result).toEqual({
      employeeId: 'emp-1',
      separationDate: new Date('2026-09-15'),
      status: 'APPROVED',
      approvedAt: new Date('2026-09-20'),
      paidAt: null,
    });
  });

  it('404s when none exists', async () => {
    const { service } = build();
    await expect(service.get('emp-1', admin)).rejects.toThrow(NotFoundException);
  });
});

describe('FullAndFinalService.updateAdvance', () => {
  it('recomputes netSettlement from the revised advance recovery figure', async () => {
    const { service, client } = build();
    client.fullAndFinalSettlement.findUnique.mockResolvedValue({
      employeeId: 'emp-1',
      status: 'DRAFT',
      unpaidSalaryAmount: new Prisma.Decimal(19000),
      leaveEncashmentAmount: new Prisma.Decimal(11538.46),
      gratuityAmount: new Prisma.Decimal(103846.15),
    });
    await service.updateAdvance('emp-1', { advanceRecoveryAmount: 10000 }, admin);
    const data = client.fullAndFinalSettlement.update.mock.calls[0][0].data;
    expect(data.advanceRecoveryAmount.toNumber()).toBe(10000);
    expect(data.netSettlement.toNumber()).toBeCloseTo(124384.61, 2);
  });

  it('rejects adjusting once the settlement is no longer DRAFT', async () => {
    const { service, client } = build();
    client.fullAndFinalSettlement.findUnique.mockResolvedValue({
      employeeId: 'emp-1',
      status: 'APPROVED',
    });
    await expect(
      service.updateAdvance('emp-1', { advanceRecoveryAmount: 1000 }, admin),
    ).rejects.toThrow(ConflictException);
  });
});

describe('FullAndFinalService.approve / markPaid', () => {
  it('moves DRAFT -> APPROVED, stamping the approver', async () => {
    const { service, client } = build();
    client.fullAndFinalSettlement.findUnique.mockResolvedValue({
      employeeId: 'emp-1',
      status: 'DRAFT',
    });
    await service.approve('emp-1', admin);
    const data = client.fullAndFinalSettlement.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'APPROVED', approvedBy: 'admin-1' });
  });

  it('rejects approving a settlement that is not DRAFT', async () => {
    const { service, client } = build();
    client.fullAndFinalSettlement.findUnique.mockResolvedValue({
      employeeId: 'emp-1',
      status: 'APPROVED',
    });
    await expect(service.approve('emp-1', admin)).rejects.toThrow(ConflictException);
  });

  it('moves APPROVED -> PAID', async () => {
    const { service, client } = build();
    client.fullAndFinalSettlement.findUnique.mockResolvedValue({
      employeeId: 'emp-1',
      status: 'APPROVED',
    });
    await service.markPaid('emp-1', admin);
    const data = client.fullAndFinalSettlement.update.mock.calls[0][0].data;
    expect(data.status).toBe('PAID');
  });

  it('rejects marking paid a settlement that is not APPROVED', async () => {
    const { service, client } = build();
    client.fullAndFinalSettlement.findUnique.mockResolvedValue({
      employeeId: 'emp-1',
      status: 'DRAFT',
    });
    await expect(service.markPaid('emp-1', admin)).rejects.toThrow(ConflictException);
  });
});
