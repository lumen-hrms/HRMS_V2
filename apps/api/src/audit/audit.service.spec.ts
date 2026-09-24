import { AuditService } from './audit.service';

function buildFakeTenantPrisma(rows: any[] = []) {
  const client = {
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      findMany: jest.fn().mockResolvedValue(rows),
    },
  };
  return { tenantId: 'tenant-1', client };
}

describe('AuditService.log', () => {
  it('writes a row scoped to the current tenant, with actor/action/target/metadata', async () => {
    const tenantPrisma = buildFakeTenantPrisma();
    const service = new AuditService(tenantPrisma as any);

    await service.log({
      actorUserId: 'user-1',
      action: 'employee.updated',
      targetType: 'employee',
      targetId: 'emp-1',
      metadata: { module: 'employee-master', fieldsChanged: ['designation'] },
    });

    expect(tenantPrisma.client.auditLog.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        action: 'employee.updated',
        targetType: 'employee',
        targetId: 'emp-1',
        ipAddress: null,
        metadata: { module: 'employee-master', fieldsChanged: ['designation'] },
      },
    });
  });

  it('swallows a failed write and logs it, never throwing into the caller', async () => {
    const tenantPrisma = buildFakeTenantPrisma();
    tenantPrisma.client.auditLog.create.mockRejectedValueOnce(new Error('db down'));
    const service = new AuditService(tenantPrisma as any);

    await expect(
      service.log({
        actorUserId: 'user-1',
        action: 'employee.updated',
        targetType: 'employee',
        targetId: 'emp-1',
        metadata: {},
      }),
    ).resolves.toBeUndefined();
  });
});

describe('AuditService.query', () => {
  function row(overrides: Record<string, any> = {}) {
    return {
      id: 'row-1',
      createdAt: new Date('2026-09-20T10:00:00Z'),
      actorUserId: 'user-1',
      action: 'employee.updated',
      targetType: 'employee',
      targetId: 'emp-1',
      metadata: { module: 'employee-master', actorName: 'Jane Doe' },
      ...overrides,
    };
  }

  it('filters by module (drawn from metadata.module, not a column)', async () => {
    const rows = [
      row({ id: 'a', metadata: { module: 'employee-master' } }),
      row({ id: 'b', metadata: { module: 'attendance' } }),
    ];
    const tenantPrisma = buildFakeTenantPrisma(rows);
    const service = new AuditService(tenantPrisma as any);

    const result = await service.query({ module: 'attendance' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b');
  });

  it('filters by an action prefix ending in a dot', async () => {
    const tenantPrisma = buildFakeTenantPrisma();
    const service = new AuditService(tenantPrisma as any);
    await service.query({ action: 'access.' });
    expect(tenantPrisma.client.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { action: { startsWith: 'access.' } } }),
    );
  });

  it('filters by date range (inclusive, by calendar day)', async () => {
    const rows = [
      row({ id: 'in-range', createdAt: new Date('2026-09-20T10:00:00Z') }),
      row({ id: 'too-early', createdAt: new Date('2026-09-01T10:00:00Z') }),
    ];
    const tenantPrisma = buildFakeTenantPrisma(rows);
    const service = new AuditService(tenantPrisma as any);

    const result = await service.query({ from: '2026-09-15', to: '2026-09-25' });
    expect(result.map((r) => r.id)).toEqual(['in-range']);
  });

  it('free-text search matches actor name, target email, action, or note', async () => {
    const rows = [
      row({ id: 'match', metadata: { module: 'employee-master', actorName: 'Priya Shah' } }),
      row({ id: 'no-match', metadata: { module: 'employee-master', actorName: 'Someone Else' } }),
    ];
    const tenantPrisma = buildFakeTenantPrisma(rows);
    const service = new AuditService(tenantPrisma as any);

    const result = await service.query({ q: 'priya' });
    expect(result.map((r) => r.id)).toEqual(['match']);
  });
});

describe('AuditService.modules', () => {
  it('returns the distinct sorted module names seen in metadata', async () => {
    const rows = [
      { metadata: { module: 'attendance' } },
      { metadata: { module: 'employee-master' } },
      { metadata: { module: 'attendance' } },
      { metadata: {} },
    ];
    const tenantPrisma = buildFakeTenantPrisma(rows);
    const service = new AuditService(tenantPrisma as any);

    await expect(service.modules()).resolves.toEqual(['attendance', 'employee-master']);
  });
});
