import { BadRequestException } from '@nestjs/common';
import { PayrollConfigService, validatePtSlabs, validateTaxSlabs } from './payroll-config.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

const admin: AuthenticatedUser = {
  sub: 'u1',
  tenantId: 't1',
  role: 'COMPANY_ADMIN',
  email: 'a@x.com',
};

function build(settingsRow: unknown = null) {
  const client = {
    payrollSettings: {
      findUnique: jest.fn().mockResolvedValue(settingsRow),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 's1' }),
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn((a: any) => ({ id: 's1', ...a.data })),
    },
    professionalTaxSlab: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockReturnValue('DELETE'),
      findMany: jest.fn().mockResolvedValue([]),
    },
    taxSlab: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockReturnValue('DELETE'),
      findMany: jest.fn().mockResolvedValue([]),
    },
    taxRegimeConfig: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const tenantPrisma = {
    tenantId: 't1',
    client,
    transaction: jest.fn(async (build: (tx: typeof client) => unknown[]) => build(client)),
  };
  return { service: new PayrollConfigService(tenantPrisma as any), client, tenantPrisma };
}

describe('validatePtSlabs', () => {
  const slab = (grossFrom: number, grossTo: number | null, monthlyAmount = 100) => ({
    grossFrom,
    grossTo,
    monthlyAmount,
  });

  it('accepts contiguous slabs ending open, in any input order', () => {
    const out = validatePtSlabs([slab(15000, null), slab(0, 15000, 0)]);
    expect(out.map((s) => s.grossFrom)).toEqual([0, 15000]);
  });

  it.each([
    ['not starting at 0', [slab(1, null)], 'start at 0'],
    ['a gap between slabs', [slab(0, 100), slab(200, null)], 'contiguous'],
    ['an overlap', [slab(0, 300), slab(200, null)], 'contiguous'],
    ['a last slab that is not open-ended', [slab(0, 100), slab(100, 200)], 'open-ended'],
    ['an open-ended slab in the middle', [slab(0, null), slab(100, null)], 'Only the last'],
    ['a slab ending before it starts', [slab(0, 0), slab(0, null)], 'end after it starts'],
  ])('rejects %s', (_label, slabs, message) => {
    expect(() => validatePtSlabs(slabs as any)).toThrow(BadRequestException);
    expect(() => validatePtSlabs(slabs as any)).toThrow(message);
  });
});

describe('PayrollConfigService', () => {
  it('seeds defaults on first read when the tenant has no settings row', async () => {
    const { service, client } = build(null);
    await service.getSettings();
    expect(client.payrollSettings.upsert).toHaveBeenCalledTimes(1);
    expect(client.professionalTaxSlab.createMany).toHaveBeenCalledTimes(1);
    const rows = client.professionalTaxSlab.createMany.mock.calls[0][0].data;
    expect(rows.every((r: any) => r.tenantId === 't1')).toBe(true);
    expect(rows.some((r: any) => r.state === 'KARNATAKA')).toBe(true);
  });

  it('does not re-seed when settings already exist (a removed slab stays removed)', async () => {
    const { service, client } = build({ id: 's1' });
    await service.getSettings();
    expect(client.payrollSettings.upsert).not.toHaveBeenCalled();
    expect(client.professionalTaxSlab.createMany).not.toHaveBeenCalled();
  });

  it("replaces a state's slabs atomically and audits without amounts", async () => {
    const { service, client, tenantPrisma } = build({ id: 's1' });
    await service.replacePtSlabs(
      'KARNATAKA' as any,
      [
        { grossFrom: 0, grossTo: 25000, monthlyAmount: 0 },
        { grossFrom: 25000, grossTo: null, monthlyAmount: 200, februaryAmount: 300 },
      ],
      admin,
    );
    expect(tenantPrisma.transaction).toHaveBeenCalledTimes(1);
    expect(client.professionalTaxSlab.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', state: 'KARNATAKA' },
    });
    const created = client.professionalTaxSlab.createMany.mock.calls[0][0].data;
    expect(created).toHaveLength(2);
    expect(created[1]).toMatchObject({ grossTo: null, februaryAmount: 300, tenantId: 't1' });
    const audit = client.auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe('payroll.pt_slabs_replaced');
    expect(JSON.stringify(audit.metadata)).not.toMatch(/200|300/);
  });

  it('writes nothing when the slab set is invalid', async () => {
    const { service, tenantPrisma } = build({ id: 's1' });
    await expect(
      service.replacePtSlabs(
        'KARNATAKA' as any,
        [{ grossFrom: 5, grossTo: null, monthlyAmount: 1 }],
        admin,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(tenantPrisma.transaction).not.toHaveBeenCalled();
  });

  it('updates settings and audits the changed field names only', async () => {
    const { service, client } = build({ id: 's1' });
    await service.updateSettings({ epfCeiling: 21000 }, admin);
    expect(client.payrollSettings.update).toHaveBeenCalledWith({
      where: { tenantId: 't1' },
      data: { epfCeiling: 21000 },
    });
    expect(client.auditLog.create.mock.calls[0][0].data.metadata).toMatchObject({
      module: 'payroll',
      fields: ['epfCeiling'],
    });
  });
});

describe('validateTaxSlabs', () => {
  const slab = (incomeFrom: number, incomeTo: number | null, ratePercent = 10) => ({
    incomeFrom,
    incomeTo,
    ratePercent,
  });

  it('accepts contiguous slabs ending open, in any input order', () => {
    const out = validateTaxSlabs([slab(300000, null), slab(0, 300000, 0)]);
    expect(out.map((s) => s.incomeFrom)).toEqual([0, 300000]);
  });

  it.each([
    ['not starting at 0', [slab(1, null)], 'start at 0'],
    ['a gap between slabs', [slab(0, 100), slab(200, null)], 'contiguous'],
    ['an overlap', [slab(0, 300), slab(200, null)], 'contiguous'],
    ['a last slab that is not open-ended', [slab(0, 100), slab(100, 200)], 'open-ended'],
    ['an open-ended slab in the middle', [slab(0, null), slab(100, null)], 'Only the last'],
    ['a slab ending before it starts', [slab(0, 0), slab(0, null)], 'end after it starts'],
  ])('rejects %s', (_label, slabs, message) => {
    expect(() => validateTaxSlabs(slabs as any)).toThrow(BadRequestException);
    expect(() => validateTaxSlabs(slabs as any)).toThrow(message);
  });
});

describe('PayrollConfigService tax config (module 07 §9 Phase 6)', () => {
  it('seeds both regimes on first read for a financial year, then returns them split by regime', async () => {
    const { service, client } = build({ id: 's1' });
    client.taxSlab.findMany
      .mockResolvedValueOnce([]) // first read: nothing yet
      .mockResolvedValueOnce([
        { regime: 'NEW', incomeFrom: 0, incomeTo: 300000, ratePercent: 0 },
        { regime: 'OLD', incomeFrom: 0, incomeTo: 250000, ratePercent: 0 },
      ]);
    client.taxRegimeConfig.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { regime: 'NEW', standardDeduction: 75000 },
      { regime: 'OLD', standardDeduction: 50000 },
    ]);

    const config = await service.getTaxConfig('2026-27');

    expect(client.taxSlab.createMany).toHaveBeenCalledTimes(1);
    expect(client.taxRegimeConfig.createMany).toHaveBeenCalledTimes(1);
    const seededSlabs = client.taxSlab.createMany.mock.calls[0][0].data;
    expect(
      seededSlabs.every((r: any) => r.tenantId === 't1' && r.financialYear === '2026-27'),
    ).toBe(true);
    expect(config.NEW.config).toMatchObject({ standardDeduction: 75000 });
    expect(config.OLD.slabs).toHaveLength(1);
  });

  it('does not re-seed when a config already exists for that financial year', async () => {
    const { service, client } = build({ id: 's1' });
    client.taxSlab.findMany.mockResolvedValue([
      { regime: 'NEW', incomeFrom: 0, incomeTo: null, ratePercent: 0 },
    ]);
    client.taxRegimeConfig.findMany.mockResolvedValue([
      { regime: 'NEW', standardDeduction: 75000 },
      { regime: 'OLD', standardDeduction: 50000 },
    ]);

    await service.getTaxConfig('2026-27');
    expect(client.taxSlab.createMany).not.toHaveBeenCalled();
    expect(client.taxRegimeConfig.createMany).not.toHaveBeenCalled();
  });

  it("replaces one regime's slabs atomically, leaving the other regime untouched", async () => {
    const { service, client, tenantPrisma } = build({ id: 's1' });
    client.taxRegimeConfig.findMany.mockResolvedValue([
      { regime: 'NEW', standardDeduction: 75000 },
      { regime: 'OLD', standardDeduction: 50000 },
    ]);
    client.taxSlab.findMany.mockResolvedValue([
      { regime: 'NEW', incomeFrom: 0, incomeTo: null, ratePercent: 0 },
    ]);

    await service.replaceTaxSlabs(
      '2026-27',
      'NEW' as any,
      [
        { incomeFrom: 0, incomeTo: 500000, ratePercent: 0 },
        { incomeFrom: 500000, incomeTo: null, ratePercent: 10 },
      ],
      admin,
    );

    expect(tenantPrisma.transaction).toHaveBeenCalledTimes(1);
    expect(client.taxSlab.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', financialYear: '2026-27', regime: 'NEW' },
    });
    const created = client.taxSlab.createMany.mock.calls[0][0].data;
    expect(created).toHaveLength(2);
    expect(created.every((r: any) => r.financialYear === '2026-27' && r.regime === 'NEW')).toBe(
      true,
    );
    const audit = client.auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe('payroll.tax_slabs_replaced');
  });

  it('writes nothing when the replacement slab set is invalid', async () => {
    const { service, client, tenantPrisma } = build({ id: 's1' });
    client.taxRegimeConfig.findMany.mockResolvedValue([
      { regime: 'NEW', standardDeduction: 75000 },
      { regime: 'OLD', standardDeduction: 50000 },
    ]);
    client.taxSlab.findMany.mockResolvedValue([
      { regime: 'NEW', incomeFrom: 0, incomeTo: null, ratePercent: 0 },
    ]);
    await expect(
      service.replaceTaxSlabs(
        '2026-27',
        'NEW' as any,
        [{ incomeFrom: 100, incomeTo: null, ratePercent: 10 }],
        admin,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(tenantPrisma.transaction).not.toHaveBeenCalled();
  });

  it('updates one regime config and audits the changed field names only', async () => {
    const { service, client } = build({ id: 's1' });
    client.taxRegimeConfig.findMany.mockResolvedValue([
      { regime: 'NEW', standardDeduction: 75000 },
      { regime: 'OLD', standardDeduction: 50000 },
    ]);
    client.taxSlab.findMany.mockResolvedValue([
      { regime: 'NEW', incomeFrom: 0, incomeTo: null, ratePercent: 0 },
      { regime: 'OLD', incomeFrom: 0, incomeTo: null, ratePercent: 0 },
    ]);

    await service.updateTaxRegimeConfig(
      '2026-27',
      'NEW' as any,
      { standardDeduction: 80000 },
      admin,
    );

    expect(client.taxRegimeConfig.update).toHaveBeenCalledWith({
      where: {
        tenantId_financialYear_regime: {
          tenantId: 't1',
          financialYear: '2026-27',
          regime: 'NEW',
        },
      },
      data: { standardDeduction: 80000 },
    });
    expect(client.auditLog.create.mock.calls[0][0].data.metadata).toMatchObject({
      module: 'payroll',
      financialYear: '2026-27',
      regime: 'NEW',
      fields: ['standardDeduction'],
    });
  });
});
