import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TdsService } from './tds.service';
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

const TAX_CONFIG = {
  NEW: {
    slabs: [{ incomeFrom: 0, incomeTo: null, ratePercent: 0 }],
    config: {
      standardDeduction: 75000,
      cessPercent: 4,
      rebateThreshold: 700000,
      rebateMaxAmount: 25000,
    },
  },
  OLD: {
    slabs: [{ incomeFrom: 0, incomeTo: null, ratePercent: 0 }],
    config: {
      standardDeduction: 50000,
      cessPercent: 4,
      rebateThreshold: 500000,
      rebateMaxAmount: 12500,
    },
  },
};

function build() {
  const client = {
    tdsRegimeChoice: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn((args: any) => ({ id: 'c1', ...args.create, ...args.update })),
    },
    payrollLineItem: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const tenantPrisma = { tenantId: 't1', client };
  const config = { getTaxConfig: jest.fn().mockResolvedValue(TAX_CONFIG) };
  const declarations = { getDeclaredExemptions: jest.fn().mockResolvedValue(0) };

  const service = new TdsService(tenantPrisma as any, config as any, declarations as any);
  return { service, client, tenantPrisma, config, declarations };
}

describe('TdsService.getEmployeeRegime', () => {
  it('defaults to NEW when no choice has been recorded', async () => {
    const { service } = build();
    const result = await service.getEmployeeRegime('emp-1', '2026-27', employee);
    expect(result).toEqual({
      employeeId: 'emp-1',
      financialYear: '2026-27',
      regime: 'NEW',
      setByUserId: null,
    });
  });

  it('returns the recorded regime when one exists', async () => {
    const { service, client } = build();
    client.tdsRegimeChoice.findUnique.mockResolvedValue({ regime: 'OLD', setByUserId: 'hr-1' });
    const result = await service.getEmployeeRegime('emp-1', '2026-27', employee);
    expect(result.regime).toBe('OLD');
    expect(result.setByUserId).toBe('hr-1');
  });

  it("lets an employee read their own regime, but not another employee's", async () => {
    const { service } = build();
    await expect(service.getEmployeeRegime('emp-1', '2026-27', employee)).resolves.toBeDefined();
    await expect(service.getEmployeeRegime('emp-1', '2026-27', otherEmployee)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("lets HR/Admin read any employee's regime", async () => {
    const { service } = build();
    await expect(service.getEmployeeRegime('emp-1', '2026-27', admin)).resolves.toBeDefined();
  });
});

describe('TdsService.setEmployeeRegime', () => {
  it('an employee setting their own regime is not audited as an override', async () => {
    const { service, client } = build();
    await service.setEmployeeRegime('emp-1', { financialYear: '2026-27', regime: 'OLD' }, employee);
    expect(client.tdsRegimeChoice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { regime: 'OLD', setByUserId: null },
        create: expect.objectContaining({ regime: 'OLD', setByUserId: null }),
      }),
    );
    expect(client.auditLog.create).not.toHaveBeenCalled();
  });

  it("HR moving an employee's regime is recorded and audited as an override (decision 8)", async () => {
    const { service, client } = build();
    await service.setEmployeeRegime('emp-1', { financialYear: '2026-27', regime: 'OLD' }, admin);
    expect(client.tdsRegimeChoice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { regime: 'OLD', setByUserId: 'admin-1' },
      }),
    );
    const audit = client.auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe('payroll.tds_regime_overridden');
    expect(audit.targetId).toBe('emp-1');
  });

  it('forbids an employee from setting someone elses regime', async () => {
    const { service } = build();
    await expect(
      service.setEmployeeRegime(
        'emp-1',
        { financialYear: '2026-27', regime: 'OLD' },
        otherEmployee,
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('TdsService.buildContext', () => {
  it('defaults an employee with no recorded choice to NEW with zero history', async () => {
    const { service } = build();
    const contexts = await service.buildContext(['emp-1'], '2026-04');
    const ctx = contexts.get('emp-1')!;
    expect(ctx.regime).toBe('NEW');
    expect(ctx.elapsedGross.toNumber()).toBe(0);
    expect(ctx.alreadyDeducted.toNumber()).toBe(0);
    expect(ctx.remainingMonths).toBe(12);
    expect(ctx.config).toBe(TAX_CONFIG.NEW.config);
  });

  it('sums elapsed gross/TDS from earlier processed periods in the same FY only', async () => {
    const { service, client } = build();
    client.payrollLineItem.findMany.mockResolvedValue([
      {
        employeeId: 'emp-1',
        grossEarnings: new Prisma.Decimal(50000),
        tdsDeducted: new Prisma.Decimal(1000),
      },
      {
        employeeId: 'emp-1',
        grossEarnings: new Prisma.Decimal(50000),
        tdsDeducted: new Prisma.Decimal(1000),
      },
    ]);
    const contexts = await service.buildContext(['emp-1'], '2026-06');
    expect(client.payrollLineItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          run: expect.objectContaining({ period: { in: ['2026-04', '2026-05'] } }),
        }),
      }),
    );
    const ctx = contexts.get('emp-1')!;
    expect(ctx.elapsedGross.toNumber()).toBe(100000);
    expect(ctx.alreadyDeducted.toNumber()).toBe(2000);
    expect(ctx.remainingMonths).toBe(10);
  });

  it('does not query history in April (nothing elapsed yet)', async () => {
    const { service, client } = build();
    await service.buildContext(['emp-1'], '2026-04');
    expect(client.payrollLineItem.findMany).not.toHaveBeenCalled();
  });

  it('picks up the recorded regime and its matching slabs/config', async () => {
    const { service, client } = build();
    client.tdsRegimeChoice.findMany.mockResolvedValue([{ employeeId: 'emp-1', regime: 'OLD' }]);
    const contexts = await service.buildContext(['emp-1'], '2026-04');
    const ctx = contexts.get('emp-1')!;
    expect(ctx.regime).toBe('OLD');
    expect(ctx.config).toBe(TAX_CONFIG.OLD.config);
  });

  it('only calls the declaration provider for employees on the OLD regime', async () => {
    const { service, client, declarations } = build();
    client.tdsRegimeChoice.findMany.mockResolvedValue([{ employeeId: 'emp-1', regime: 'OLD' }]);
    declarations.getDeclaredExemptions.mockResolvedValue(150000);

    const contexts = await service.buildContext(['emp-1', 'emp-2'], '2026-04');

    expect(declarations.getDeclaredExemptions).toHaveBeenCalledTimes(1);
    expect(declarations.getDeclaredExemptions).toHaveBeenCalledWith('emp-1', '2026-27');
    expect(contexts.get('emp-1')!.declaredExemptions).toBe(150000);
    expect(contexts.get('emp-2')!.declaredExemptions).toBe(0); // NEW regime, never asked
  });
});
