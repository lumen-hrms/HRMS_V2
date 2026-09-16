import { PlatformAdminService } from './platform-admin.service';

/** Minimal fake of the `hrms_platform`-role Prisma surface the audit read
 * path touches — `PlatformAuditLog` only. */
function buildFakePlatformPrisma(rows: any[]) {
  return {
    platformAuditLog: {
      findMany: jest.fn().mockResolvedValue(rows),
    },
  };
}

function buildService(rows: any[]) {
  const platformPrisma = buildFakePlatformPrisma(rows);
  const config = { get: jest.fn() };
  const service = new PlatformAdminService(
    platformPrisma as any,
    {} as any,
    config as any,
    {} as any,
    {} as any,
  );
  return { service, platformPrisma };
}

const BASE_ROW = {
  id: 'row-1',
  actorEmail: 'ops@lumenhrms.com',
  targetType: 'tenant',
  targetId: 'tenant-1',
  createdAt: new Date('2026-06-01T10:00:00.000Z'),
};

describe('PlatformAdminService.audit', () => {
  it('reshapes a tenant.status_changed row into { before, after, note }', async () => {
    const { service } = buildService([
      {
        ...BASE_ROW,
        action: 'tenant.status_changed',
        metadata: { tenantName: 'Acme Co', from: 'ACTIVE', to: 'SUSPENDED', reason: 'Non-payment' },
      },
    ]);

    const result = await service.audit({});

    expect(result).toEqual([
      {
        id: 'row-1',
        at: '2026-06-01T10:00:00.000Z',
        actorEmail: 'ops@lumenhrms.com',
        action: 'tenant.status_changed',
        targetTenantName: 'Acme Co',
        before: 'ACTIVE',
        after: 'SUSPENDED',
        note: 'Non-payment',
      },
    ]);
  });

  it('reshapes a tenant.created row (no before/after transition, just plan + seats)', async () => {
    const { service } = buildService([
      {
        ...BASE_ROW,
        action: 'tenant.created',
        metadata: {
          tenantName: 'Globex',
          subdomain: 'globex',
          plan: 'GROWTH',
          seats: 50,
          pricePerSeat: '199.00',
        },
      },
    ]);

    const [row] = await service.audit({});

    expect(row.before).toBeNull();
    expect(row.after).toBe('GROWTH · 50 seats');
    expect(row.note).toBe('subdomain: globex');
    expect(row.targetTenantName).toBe('Globex');
  });

  it('filters by action', async () => {
    const { service, platformPrisma } = buildService([]);

    await service.audit({ action: 'tenant.plan_changed' as any });

    expect(platformPrisma.platformAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { action: 'tenant.plan_changed' } }),
    );
  });

  it('filters by tenantId (targetId)', async () => {
    const { service, platformPrisma } = buildService([]);

    await service.audit({ tenantId: 'tenant-42' });

    expect(platformPrisma.platformAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { targetId: 'tenant-42' } }),
    );
  });

  it('excludes rows outside the from/to date range', async () => {
    const { service } = buildService([
      {
        ...BASE_ROW,
        id: 'row-early',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        action: 'tenant.created',
        metadata: { tenantName: 'Old Co' },
      },
      {
        ...BASE_ROW,
        id: 'row-in-range',
        createdAt: new Date('2026-06-15T00:00:00.000Z'),
        action: 'tenant.created',
        metadata: { tenantName: 'New Co' },
      },
    ]);

    const result = await service.audit({ from: '2026-06-01', to: '2026-06-30' });

    expect(result.map((r) => r.id)).toEqual(['row-in-range']);
  });

  it('applies the free-text search across actor email and tenant name', async () => {
    const { service } = buildService([
      {
        ...BASE_ROW,
        id: 'row-a',
        action: 'tenant.created',
        metadata: { tenantName: 'Acme Co' },
      },
      {
        ...BASE_ROW,
        id: 'row-b',
        action: 'tenant.created',
        metadata: { tenantName: 'Globex' },
      },
    ]);

    const result = await service.audit({ q: 'acme' });

    expect(result.map((r) => r.id)).toEqual(['row-a']);
  });
});
