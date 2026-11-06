import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PlatformAdminService } from './platform-admin.service';
import * as withTenantContextModule from '../prisma/with-tenant-context';

jest.mock('../prisma/with-tenant-context');

const TENANT = {
  id: 'tenant-1',
  name: 'Acme Co',
  subdomain: 'acme',
  status: 'ACTIVE',
  employeeCount: 10,
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  subscription: { plan: 'GROWTH', seats: 50 },
};

function buildService(overrides: Record<string, any> = {}) {
  const auditCreate = jest.fn().mockResolvedValue(undefined);
  const platformPrisma = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue(TENANT),
      update: jest.fn().mockImplementation(({ data }) => ({ ...TENANT, ...data })),
    },
    platformAuditLog: {
      create: jest.fn(() => ({ catch: jest.fn() })),
      findMany: jest.fn().mockResolvedValue([]),
    },
    breakGlassGrant: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    },
    ...overrides,
  };
  platformPrisma.platformAuditLog.create = jest
    .fn()
    .mockReturnValue({ catch: () => Promise.resolve() });

  const fakeTenantClient = { user: { findFirst: jest.fn().mockResolvedValue(null) } };
  (withTenantContextModule.withTenantContext as jest.Mock).mockReturnValue(fakeTenantClient);

  const service = new PlatformAdminService(
    platformPrisma as any,
    {} as any,
    { get: jest.fn() } as any,
    {} as any,
    {} as any,
    { sendPasswordReset: jest.fn().mockResolvedValue('ses') } as any,
  );
  return { service, platformPrisma, fakeTenantClient, auditCreate };
}

describe('PlatformAdminService.getTenant', () => {
  it('throws NotFoundException for an unknown tenant', async () => {
    const { service, platformPrisma } = buildService();
    platformPrisma.tenant.findUnique.mockResolvedValueOnce(null);
    await expect(service.getTenant('missing')).rejects.toThrow(NotFoundException);
  });

  it('returns tenant detail with firstAdminEmail and headcountHistory', async () => {
    const { service, fakeTenantClient } = buildService();
    fakeTenantClient.user.findFirst.mockResolvedValue({ email: 'admin@acme.com' });

    const result = await service.getTenant('tenant-1');

    expect(result.firstAdminEmail).toBe('admin@acme.com');
    expect(result.headcountHistory).toEqual([{ at: '2026-09-01T00:00:00.000Z', count: 10 }]);
    expect(result.recentAudit).toEqual([]);
  });
});

describe('PlatformAdminService.refreshHeadcountRoute', () => {
  it('throws NotFoundException for an unknown tenant', async () => {
    const { service, platformPrisma } = buildService();
    platformPrisma.tenant.findUnique.mockResolvedValueOnce(null);
    await expect(service.refreshHeadcountRoute('missing')).rejects.toThrow(NotFoundException);
  });

  it('updates employeeCount and writes an audit row when it changed', async () => {
    const { service, platformPrisma, fakeTenantClient } = buildService();
    platformPrisma.tenant.findUnique.mockResolvedValueOnce({ employeeCount: 10, name: 'Acme Co' });
    (fakeTenantClient as any).employee = { count: jest.fn().mockResolvedValue(15) };

    const result = await service.refreshHeadcountRoute('tenant-1', 'ops@lumenhrms.com');

    expect(result).toEqual({ employeeCount: 15 });
    expect(platformPrisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      data: { employeeCount: 15 },
    });
    expect(platformPrisma.platformAuditLog.create).toHaveBeenCalled();
  });

  it('skips the audit write when the count did not change', async () => {
    const { service, platformPrisma, fakeTenantClient } = buildService();
    platformPrisma.tenant.findUnique.mockResolvedValueOnce({ employeeCount: 10, name: 'Acme Co' });
    (fakeTenantClient as any).employee = { count: jest.fn().mockResolvedValue(10) };

    await service.refreshHeadcountRoute('tenant-1');

    expect(platformPrisma.platformAuditLog.create).not.toHaveBeenCalled();
  });
});

describe('PlatformAdminService break-glass', () => {
  it('requestBreakGlass creates a grant and returns { id, expiresAt }', async () => {
    const { service, platformPrisma } = buildService();
    platformPrisma.breakGlassGrant.findFirst.mockResolvedValue(null);
    platformPrisma.breakGlassGrant.create.mockResolvedValue({
      id: 'grant-1',
      expiresAt: new Date('2026-09-01T01:00:00.000Z'),
    });

    const result = await service.requestBreakGlass(
      'tenant-1',
      { reason: 'Sev-1 investigation', ttlMinutes: 60 },
      'ops@lumenhrms.com',
    );

    expect(result.id).toBe('grant-1');
    expect(platformPrisma.breakGlassGrant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: 'tenant-1', reason: 'Sev-1 investigation' }),
      }),
    );
  });

  it('requestBreakGlass rejects a second concurrent grant', async () => {
    const { service, platformPrisma } = buildService();
    platformPrisma.breakGlassGrant.findFirst.mockResolvedValue({ id: 'existing' });

    await expect(
      service.requestBreakGlass('tenant-1', { reason: 'x'.repeat(12), ttlMinutes: 15 }),
    ).rejects.toThrow(ConflictException);
  });

  it('requestBreakGlass 404s for an unknown tenant', async () => {
    const { service, platformPrisma } = buildService();
    platformPrisma.tenant.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.requestBreakGlass('missing', { reason: 'x'.repeat(12), ttlMinutes: 15 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('revokeBreakGlass rejects an already-inactive grant', async () => {
    const { service, platformPrisma } = buildService();
    platformPrisma.breakGlassGrant.findUnique.mockResolvedValue({
      id: 'grant-1',
      tenantId: 'tenant-1',
      status: 'EXPIRED',
      tenant: { name: 'Acme Co' },
    });

    await expect(service.revokeBreakGlass('tenant-1', 'grant-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('revokeBreakGlass 404s when the grant belongs to a different tenant', async () => {
    const { service, platformPrisma } = buildService();
    platformPrisma.breakGlassGrant.findUnique.mockResolvedValue({
      id: 'grant-1',
      tenantId: 'other-tenant',
      status: 'ACTIVE',
      tenant: { name: 'Acme Co' },
    });

    await expect(service.revokeBreakGlass('tenant-1', 'grant-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('revokeBreakGlass marks an active grant REVOKED and audits it', async () => {
    const { service, platformPrisma } = buildService();
    platformPrisma.breakGlassGrant.findUnique.mockResolvedValue({
      id: 'grant-1',
      tenantId: 'tenant-1',
      status: 'ACTIVE',
      tenant: { name: 'Acme Co' },
    });

    const result = await service.revokeBreakGlass('tenant-1', 'grant-1', 'ops@lumenhrms.com');

    expect(result).toEqual({ status: 'REVOKED' });
    expect(platformPrisma.breakGlassGrant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'grant-1' },
        data: expect.objectContaining({ status: 'REVOKED', revokedBy: 'ops@lumenhrms.com' }),
      }),
    );
    expect(platformPrisma.platformAuditLog.create).toHaveBeenCalled();
  });

  it('expireOverdueBreakGlassGrants flips overdue ACTIVE grants to EXPIRED', async () => {
    const { service, platformPrisma } = buildService();
    platformPrisma.breakGlassGrant.findMany.mockResolvedValue([
      { id: 'grant-1', tenantId: 'tenant-1', tenant: { name: 'Acme Co' } },
      { id: 'grant-2', tenantId: 'tenant-2', tenant: { name: 'Beta Co' } },
    ]);

    const count = await service.expireOverdueBreakGlassGrants();

    expect(count).toBe(2);
    expect(platformPrisma.breakGlassGrant.update).toHaveBeenCalledTimes(2);
    expect(platformPrisma.platformAuditLog.create).toHaveBeenCalledTimes(2);
  });
});
