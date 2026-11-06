import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PayrollBankService } from './payroll-bank.service';

const admin = { sub: 'u-admin', role: 'COMPANY_ADMIN' } as AuthenticatedUser;
const employeeUser = { sub: 'u-emp', role: 'EMPLOYEE' } as AuthenticatedUser;
const D = (n: number) => new Prisma.Decimal(n);

function build() {
  const client: any = {
    payrollRun: { findUnique: jest.fn() },
    payrollLineItem: { findMany: jest.fn().mockResolvedValue([]) },
    employee: { findMany: jest.fn().mockResolvedValue([]) },
    payrollBankConfig: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const fieldEncryption = {
    encrypt: jest.fn((v: string) => `enc:${v}`),
    decrypt: jest.fn((v: string) => v.replace(/^enc:/, '')),
  };
  const service = new PayrollBankService({ client, tenantId: 't1' } as any, fieldEncryption as any);
  return { service, client, fieldEncryption };
}

const run = { id: 'run-1', status: 'PROCESSED', period: '2026-09' };
const emp = (id: string, extra: object = {}) => ({
  id,
  firstName: 'Asha',
  lastName: id,
  employeeCode: `E-${id}`,
  bankAccountCiphertext: 'enc:123456789012',
  bankIfsc: 'SBIN0001234',
  bankName: null,
  ...extra,
});

function seed(ctx: ReturnType<typeof build>, employees: object[], amounts: number[]) {
  ctx.client.payrollRun.findUnique.mockResolvedValue(run);
  ctx.client.payrollLineItem.findMany.mockResolvedValue(
    employees.map((e: any, i) => ({ employeeId: e.id, netPay: D(amounts[i]) })),
  );
  ctx.client.employee.findMany.mockResolvedValue(employees);
}

describe('PayrollBankService.preview', () => {
  it('counts, totals and splits by payment mode using the company bank', async () => {
    const ctx = build();
    ctx.client.payrollBankConfig.findUnique.mockResolvedValue({
      bankCode: 'HDFC',
      ifsc: 'HDFC0000001',
      accountMasked: '••••9012',
      defaultPaymentMode: 'NEFT',
      accountCiphertext: 'enc:111122223333',
      accountHolderName: 'Acme',
      bankName: null,
    });
    seed(ctx, [emp('a', { bankIfsc: 'HDFC0009999' }), emp('b')], [40000, 30000]);
    const r = await ctx.service.preview('run-1', 'CSV', admin);
    expect(r.counts).toEqual({ paid: 2, included: 2, leftOut: 0 });
    expect(r.total).toBe('70000.00');
    expect(r.byMode).toEqual([
      { mode: 'OWN_BANK', count: 1, total: '40000.00' },
      { mode: 'NEFT', count: 1, total: '30000.00' },
    ]);
    expect(r.warnings).toEqual([]);
  });

  it('names employees left out, with the reason', async () => {
    const ctx = build();
    seed(
      ctx,
      [
        emp('a'),
        emp('b', { bankAccountCiphertext: null, bankIfsc: null }),
        emp('c', { bankIfsc: 'BAD' }),
      ],
      [1000, 1000, 1000],
    );
    const r = await ctx.service.preview('run-1', 'CSV', admin);
    expect(r.counts).toEqual({ paid: 3, included: 1, leftOut: 2 });
    expect(r.leftOut.map((l) => [l.employeeCode, l.reason])).toEqual([
      ['E-b', 'MISSING_BANK_DETAILS'],
      ['E-c', 'INVALID_DETAILS'],
    ]);
    expect(r.leftOut[0].problems).toEqual(['No bank account number', 'No IFSC code']);
  });

  it('warns when the company bank is not set up and when the format is for another bank', async () => {
    const ctx = build();
    seed(ctx, [emp('a')], [1000]);
    expect((await ctx.service.preview('run-1', 'CSV', admin)).warnings[0]).toMatch(/isn’t set up/);
    ctx.client.payrollBankConfig.findUnique.mockResolvedValue({
      bankCode: 'ICICI',
      ifsc: 'ICIC0000001',
      accountMasked: 'x',
    });
    const r = await ctx.service.preview('run-1', 'HDFC', admin);
    expect(r.warnings.join(' ')).toMatch(/layout, but the account/);
    expect(r.warnings.join(' ')).toMatch(/isn’t available yet/);
    expect(r.format.available).toBe(false);
  });

  it('refuses before the run is processed and for non-payroll roles', async () => {
    const ctx = build();
    ctx.client.payrollRun.findUnique.mockResolvedValue({ ...run, status: 'APPROVED' });
    await expect(ctx.service.preview('run-1', 'CSV', admin)).rejects.toThrow(ConflictException);
    await expect(ctx.service.preview('run-1', 'CSV', employeeUser)).rejects.toThrow(
      ForbiddenException,
    );
    ctx.client.payrollRun.findUnique.mockResolvedValue(run);
    await expect(ctx.service.preview('run-1', 'NOPE', admin)).rejects.toThrow(BadRequestException);
  });
});

describe('PayrollBankService.generate', () => {
  it('produces the generic CSV with decrypted accounts, cleaned names and payment modes; audits it', async () => {
    const ctx = build();
    seed(
      ctx,
      [emp('a', { firstName: 'José' }), emp('b', { bankAccountCiphertext: null })],
      [40000, 1],
    );
    const f = await ctx.service.generate('run-1', 'CSV', admin);
    expect(f.filename).toBe('bank-file-2026-09.csv');
    expect(f.mimeType).toBe('text/csv');
    expect(f.content).toContain('Jose a,123456789012,SBIN0001234');
    expect(f.content).toContain('40000.00,NEFT');
    expect(f.skippedEmployeeCount).toBe(1);
    expect(f.summary.leftOut[0].employeeCode).toBe('E-b');
    expect(ctx.client.auditLog.create).toHaveBeenCalled();
    const meta = ctx.client.auditLog.create.mock.calls[0][0].data.metadata;
    expect(meta).toMatchObject({ format: 'CSV', rowCount: 1, skippedCount: 1 });
    expect(JSON.stringify(meta)).not.toContain('123456789012');
  });

  it('refuses a launch bank whose layout is not built yet', async () => {
    const ctx = build();
    seed(ctx, [emp('a')], [1000]);
    await expect(ctx.service.generate('run-1', 'HDFC', admin)).rejects.toThrow(
      /isn’t available yet/,
    );
    expect(ctx.client.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('PayrollBankService config', () => {
  const dto = {
    bankCode: 'HDFC',
    accountHolderName: 'Acme Health Pvt Ltd',
    accountNumber: '123456789012',
    ifsc: 'HDFC0001234',
    defaultPaymentMode: 'NEFT' as const,
  };

  it('stores the account encrypted and returns only the masked form', async () => {
    const ctx = build();
    await ctx.service.saveConfig(dto, admin);
    const args = ctx.client.payrollBankConfig.upsert.mock.calls[0][0];
    expect(args.create.accountCiphertext).toBe('enc:123456789012');
    expect(args.create.accountMasked).not.toContain('123456789012');
    const audit = ctx.client.auditLog.create.mock.calls[0][0].data.metadata;
    expect(JSON.stringify(audit)).not.toContain('123456789012');
  });

  it('requires an account number the first time, but not when editing', async () => {
    const ctx = build();
    await expect(
      ctx.service.saveConfig({ ...dto, accountNumber: undefined }, admin),
    ).rejects.toThrow(BadRequestException);
    ctx.client.payrollBankConfig.findUnique.mockResolvedValue({ id: 'x' });
    await ctx.service.saveConfig(
      { ...dto, accountNumber: undefined, defaultPaymentMode: 'IMPS' },
      admin,
    );
    const upd = ctx.client.payrollBankConfig.upsert.mock.calls[0][0].update;
    expect(upd.accountCiphertext).toBeUndefined();
    expect(upd.defaultPaymentMode).toBe('IMPS');
  });

  it('rejects an IFSC that does not belong to the chosen bank', async () => {
    const ctx = build();
    await expect(ctx.service.saveConfig({ ...dto, bankCode: 'ICICI' }, admin)).rejects.toThrow(
      /doesn’t belong to ICICI Bank/,
    );
    expect(ctx.client.payrollBankConfig.upsert).not.toHaveBeenCalled();
  });

  it('refuses non-payroll roles', async () => {
    const ctx = build();
    await expect(ctx.service.saveConfig(dto, employeeUser)).rejects.toThrow(ForbiddenException);
  });
});

describe('PayrollBankService.listFormats', () => {
  it('lists the generic CSV as available and the launch banks as pending', () => {
    const f = build().service.listFormats();
    expect(f.find((x) => x.id === 'CSV')?.available).toBe(true);
    expect(f.filter((x) => !x.available).map((x) => x.id)).toEqual([
      'ICICI',
      'AXIS',
      'SBI',
      'HDFC',
      'HSBC',
    ]);
  });
});
