import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SalaryStructureService } from './salary-structure.service';
import { PayrollController } from './payroll.controller';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { REQUIRES_MODULE_KEY } from '../common/decorators/requires-module.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import type { UpsertSalaryStructureDto } from './dto/payroll.dto';

const user = (role: string, employeeId: string | null = null): AuthenticatedUser => ({
  sub: 'u1',
  tenantId: 't1',
  role,
  email: 'x@x.com',
  employeeId,
});
const hr = user('HR_MANAGER');
const EMP = '11111111-1111-1111-1111-111111111111';

const dto = (over: Partial<UpsertSalaryStructureDto> = {}): UpsertSalaryStructureDto => ({
  ctcAnnual: 1200000,
  effectiveFrom: '2026-04-01',
  components: [
    { type: 'BASIC', name: 'Basic', calculationMode: 'PERCENT_OF_CTC', value: 50 },
    { type: 'HRA', name: 'HRA', calculationMode: 'PERCENT_OF_BASIC', value: 40 },
  ],
  ...over,
});

function stored(id = 's1') {
  return {
    id,
    tenantId: 't1',
    employeeId: EMP,
    ctcAnnual: new Prisma.Decimal(1200000),
    effectiveFrom: new Date('2026-04-01'),
    status: 'ACTIVE',
    components: [
      {
        id: 'c1',
        code: 'BASIC',
        type: 'BASIC',
        name: 'Basic',
        calculationMode: 'PERCENT_OF_CTC',
        value: new Prisma.Decimal(50),
        formula: null,
        sortOrder: 0,
      },
      {
        id: 'c2',
        code: 'HRA',
        type: 'HRA',
        name: 'HRA',
        calculationMode: 'PERCENT_OF_BASIC',
        value: new Prisma.Decimal(40),
        formula: null,
        sortOrder: 1,
      },
    ],
  };
}

const ZERO_RATE_SETTINGS = {
  minBasicPercent: new Prisma.Decimal(50),
  epfCeiling: new Prisma.Decimal(1000000),
  allowEpfAboveCeiling: true,
  epfEmployeeRate: new Prisma.Decimal(0),
  epsRate: new Prisma.Decimal(0),
  epfEmployerRate: new Prisma.Decimal(0),
  epfAdminRate: new Prisma.Decimal(0),
  edliRate: new Prisma.Decimal(0),
  esiWageCeiling: new Prisma.Decimal(0),
  esiEmployeeRate: new Prisma.Decimal(0),
  esiEmployerRate: new Prisma.Decimal(0),
};

function build(
  over: {
    active?: unknown;
    employee?: unknown;
    createError?: unknown;
    affectedLineItems?: unknown[];
    settings?: unknown;
  } = {},
) {
  const client = {
    employee: {
      findUnique: jest.fn().mockResolvedValue('employee' in over ? over.employee : { id: EMP }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ workState: 'KARNATAKA' }),
    },
    salaryStructure: {
      findFirst: jest.fn().mockResolvedValue('active' in over ? over.active : null),
      create: jest.fn(async (_args: any) => {
        if (over.createError) throw over.createError;
        return stored();
      }),
      update: jest.fn(async (_args: any) => stored()),
    },
    payrollLineItem: {
      findMany: jest.fn().mockResolvedValue(over.affectedLineItems ?? []),
    },
    professionalTaxSlab: { findMany: jest.fn().mockResolvedValue([]) },
    salaryRevision: { create: jest.fn().mockResolvedValue({}) },
    arrearsLineItem: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const tenantPrisma = {
    tenantId: 't1',
    client,
    transaction: jest.fn(async (build: (tx: typeof client) => unknown[]) =>
      Promise.all(build(client)),
    ),
  };
  const config = {
    getSettings: jest
      .fn()
      .mockResolvedValue(over.settings ?? { minBasicPercent: new Prisma.Decimal(50) }),
  };
  return {
    service: new SalaryStructureService(tenantPrisma as any, config as any),
    client,
    tenantPrisma,
    config,
  };
}

describe('SalaryStructureService', () => {
  describe('read scoping', () => {
    it.each([
      ['HR_MANAGER', hr],
      ['COMPANY_ADMIN', user('COMPANY_ADMIN')],
      ['EMPLOYEE (own)', user('EMPLOYEE', EMP)],
    ])('%s can read', async (_l, u) => {
      const { service } = build({ active: stored() });
      const res = await service.get(EMP, u);
      expect(res.monthlyCtc.toString()).toBe('100000');
      expect(res.basicPercentOfCtc!.toString()).toBe('50');
      expect(res.components.find((c) => c.code === 'HRA')!.monthlyAmount.toString()).toBe('20000');
    });

    it.each([
      ['EMPLOYEE (someone else)', user('EMPLOYEE', 'other-employee')],
      ['LINE_MANAGER', user('LINE_MANAGER', 'mgr')],
      ['AUDITOR', user('AUDITOR')],
    ])('%s is forbidden and nothing is queried', async (_l, u) => {
      const { service, client } = build({ active: stored() });
      await expect(service.get(EMP, u)).rejects.toThrow(ForbiddenException);
      expect(client.salaryStructure.findFirst).not.toHaveBeenCalled();
    });

    it('404s for a missing employee and for an employee without a structure', async () => {
      await expect(build({ employee: null }).service.get(EMP, hr)).rejects.toThrow(
        'Employee not found',
      );
      await expect(build({ active: null }).service.get(EMP, hr)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates structure + components in one nested write, stamping tenantId', async () => {
      const { service, client } = build();
      await service.create(EMP, dto(), hr);
      const data = client.salaryStructure.create.mock.calls[0][0].data;
      expect(data.tenantId).toBe('t1');
      expect(data.components.create).toHaveLength(2);
      expect(data.components.create.every((c: any) => c.tenantId === 't1')).toBe(true);
    });

    it('rejects when an active structure already exists, writing nothing', async () => {
      const { service, client } = build({ active: stored() });
      await expect(service.create(EMP, dto(), hr)).rejects.toThrow(ConflictException);
      expect(client.salaryStructure.create).not.toHaveBeenCalled();
    });

    it('maps the partial-unique-index race (P2002) to a 409', async () => {
      const err = new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      });
      const { service } = build({ createError: err });
      await expect(service.create(EMP, dto(), hr)).rejects.toThrow(ConflictException);
    });

    it("enforces INV-3 using the tenant's configured floor and writes nothing on failure", async () => {
      const { service, client } = build();
      const low = dto({
        components: [
          { type: 'BASIC', name: 'Basic', calculationMode: 'PERCENT_OF_CTC', value: 30 },
        ],
      });
      await expect(service.create(EMP, low, hr)).rejects.toThrow('at least 50%');
      expect(client.salaryStructure.create).not.toHaveBeenCalled();
    });

    it('audits without compensation amounts', async () => {
      const { service, client } = build();
      await service.create(EMP, dto(), hr);
      const audit = client.auditLog.create.mock.calls[0][0].data;
      expect(audit).toMatchObject({ action: 'payroll.salary_structure_created', targetId: EMP });
      expect(JSON.stringify(audit.metadata)).not.toMatch(/1200000|ctc/i);
    });
  });

  describe('update', () => {
    it('replaces components atomically via a nested deleteMany + create', async () => {
      const { service, client } = build({ active: stored() });
      await service.update(EMP, dto(), hr);
      const args = client.salaryStructure.update.mock.calls[0][0];
      expect(args.where).toEqual({ id: 's1' });
      expect(args.data.components.deleteMany).toEqual({});
      expect(args.data.components.create).toHaveLength(2);
    });

    it('404s when there is nothing to update; validates before writing', async () => {
      await expect(build({ active: null }).service.update(EMP, dto(), hr)).rejects.toThrow(
        NotFoundException,
      );
      const { service, client } = build({ active: stored() });
      const low = dto({
        components: [{ type: 'BASIC', name: 'Basic', calculationMode: 'FIXED', value: 1000 }],
      });
      await expect(service.update(EMP, low, hr)).rejects.toThrow('at least 50%');
      expect(client.salaryStructure.update).not.toHaveBeenCalled();
    });
  });

  describe('revise (module 07 §9 Phase 7)', () => {
    const reviseDto = (over: Partial<Record<string, unknown>> = {}) => ({
      ctcAnnual: 1320000, // old was 1,200,000 — a 10% raise
      effectiveDate: '2026-09-01',
      components: [
        { type: 'BASIC', name: 'Basic', calculationMode: 'PERCENT_OF_CTC', value: 50 },
        { type: 'HRA', name: 'HRA', calculationMode: 'PERCENT_OF_BASIC', value: 40 },
      ],
      reason: 'Delayed annual appraisal',
      ...over,
    });

    it('404s when the employee has no active structure to revise', async () => {
      const { service } = build({ active: null, settings: ZERO_RATE_SETTINGS });
      await expect(service.revise(EMP, reviseDto() as any, hr)).rejects.toThrow(NotFoundException);
    });

    it('supersedes the old structure and creates the new one, with no arrears when nothing was already processed', async () => {
      const { service, client, tenantPrisma } = build({
        active: stored(),
        settings: ZERO_RATE_SETTINGS,
      });

      const result = await service.revise(EMP, reviseDto() as any, hr);

      expect(tenantPrisma.transaction).toHaveBeenCalledTimes(1);
      expect(client.salaryStructure.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { status: 'SUPERSEDED' },
      });
      const created = client.salaryStructure.create.mock.calls[0][0].data;
      expect(created.ctcAnnual).toBe(1320000);
      expect(created.components.create).toHaveLength(2);
      const revision = client.salaryRevision.create.mock.calls[0][0].data;
      expect(revision).toMatchObject({
        employeeId: EMP,
        previousStructureId: 's1',
        reason: 'Delayed annual appraisal',
        approvedBy: 'u1',
      });
      expect(client.arrearsLineItem.createMany).not.toHaveBeenCalled();
      expect(result).toMatchObject({ arrearsGenerated: 0, arrearsPeriods: [] });
    });

    it('generates one ArrearsLineItem per already-processed affected period, with a hand-verified delta', async () => {
      // Old structure: Basic 50% of 1,200,000 CTC = 50,000/mo; HRA 40% of
      // Basic = 20,000/mo -> gross 70,000. New: Basic 50% of 1,320,000 =
      // 55,000/mo; HRA 40% of Basic = 22,000/mo -> gross 77,000. Full month
      // (workingDays=payableDays=22), zero EPF/ESI/PT -> net = gross on
      // both sides, so the arrears delta is exactly 77,000 - 70,000 = 7,000.
      const { service, client } = build({
        active: stored(),
        settings: ZERO_RATE_SETTINGS,
        affectedLineItems: [
          { workingDays: 22, payableDays: 22, run: { id: 'run-1', period: '2026-07' } },
          { workingDays: 22, payableDays: 22, run: { id: 'run-2', period: '2026-08' } },
        ],
      });

      const result = await service.revise(EMP, reviseDto() as any, hr);

      expect(client.arrearsLineItem.createMany).toHaveBeenCalledTimes(1);
      const rows = client.arrearsLineItem.createMany.mock.calls[0][0].data;
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        employeeId: EMP,
        period: '2026-07',
        originalRunId: 'run-1',
      });
      expect(rows[0].previousNetPay.toNumber()).toBe(70000);
      expect(rows[0].revisedNetPay.toNumber()).toBe(77000);
      expect(rows[0].amount.toNumber()).toBe(7000);
      expect(rows[1].period).toBe('2026-08');
      expect(result.arrearsGenerated).toBe(2);
      expect(result.arrearsPeriods).toEqual(['2026-07', '2026-08']);
    });

    it('audits the revision by id and affected periods only, never a compensation amount', async () => {
      const { service, client } = build({
        active: stored(),
        settings: ZERO_RATE_SETTINGS,
        affectedLineItems: [
          { workingDays: 22, payableDays: 22, run: { id: 'run-1', period: '2026-07' } },
        ],
      });
      await service.revise(EMP, reviseDto() as any, hr);
      const audit = client.auditLog.create.mock.calls[0][0].data;
      expect(audit).toMatchObject({ action: 'payroll.salary_structure_revised', targetId: EMP });
      expect(audit.metadata.arrearsPeriods).toEqual(['2026-07']);
      expect(JSON.stringify(audit.metadata)).not.toMatch(/7000|70000|77000/);
    });

    it('validates the new components before writing anything (reuses the Basic-floor rule)', async () => {
      const { service, client, tenantPrisma } = build({
        active: stored(),
        settings: ZERO_RATE_SETTINGS,
      });
      const low = reviseDto({
        components: [{ type: 'BASIC', name: 'Basic', calculationMode: 'FIXED', value: 1000 }],
      });
      await expect(service.revise(EMP, low as any, hr)).rejects.toThrow('at least 50%');
      expect(tenantPrisma.transaction).not.toHaveBeenCalled();
      expect(client.arrearsLineItem.createMany).not.toHaveBeenCalled();
    });
  });
});

describe('PayrollController authorization matrix (module 07 §8)', () => {
  const proto = PayrollController.prototype as any;
  const roles = (handler: string) => Reflect.getMetadata(ROLES_KEY, proto[handler]);

  it('is gated behind the PAYROLL plan entitlement', () => {
    expect(Reflect.getMetadata(REQUIRES_MODULE_KEY, PayrollController)).toBe('PAYROLL');
  });

  it('only HR Manager / Company Admin can write structures and config', () => {
    for (const h of [
      'createStructure',
      'updateStructure',
      'reviseStructure',
      'updateSettings',
      'replacePtSlabs',
    ]) {
      expect(roles(h)).toEqual(['COMPANY_ADMIN', 'HR_MANAGER']);
    }
  });

  it('Auditor can read config but not individual structures', () => {
    expect(roles('getSettings')).toContain('AUDITOR');
    expect(roles('listPtSlabs')).toContain('AUDITOR');
    // No @Roles on getStructure: row scoping (HR/Admin all, Employee own,
    // everyone else 403) is enforced in the service — covered above.
    expect(roles('getStructure')).toBeUndefined();
  });

  it('only HR Manager / Company Admin can create or act on a payroll run (module 07 Phase 3)', () => {
    for (const h of [
      'createRun',
      'setLineItemAdjustments',
      'recalculate',
      'submitForReview',
      'approve',
      'process',
      'disburse',
    ]) {
      expect(roles(h)).toEqual(['COMPANY_ADMIN', 'HR_MANAGER']);
    }
  });

  it('Auditor can read a run, scoped down in the service (decision 9)', () => {
    expect(roles('getRun')).toEqual(['COMPANY_ADMIN', 'HR_MANAGER', 'AUDITOR']);
  });

  it('only HR Manager / Company Admin can download the bank file (module 07 Phase 5)', () => {
    expect(roles('getBankFile')).toEqual(['COMPANY_ADMIN', 'HR_MANAGER']);
  });

  it('only HR Manager / Company Admin can generate/adjust/approve/pay a Full & Final settlement (module 07 Phase 8)', () => {
    for (const h of ['generateFnf', 'updateFnfAdvance', 'approveFnf', 'markFnfPaid']) {
      expect(roles(h)).toEqual(['COMPANY_ADMIN', 'HR_MANAGER']);
    }
  });

  it('has no @Roles on getFnf: row scoping (own, HR/Admin any, Auditor reduced) is enforced in the service', () => {
    expect(roles('getFnf')).toBeUndefined();
  });

  it('has no @Roles on getPayslip: row scoping (own vs HR/Admin) is enforced in the service', () => {
    expect(roles('getPayslip')).toBeUndefined();
  });
});
