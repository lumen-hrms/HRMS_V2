import { ServiceUnavailableException } from '@nestjs/common';
import { PlatformAdminService } from './platform-admin.service';

// `seedCompanyAdmin` fires a real hosted-reset-email HTTP call otherwise —
// these tests are about Firebase Admin (createUser/setCustomUserClaims)
// failure handling, not the reset-email send, so keep it a no-op here.

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

/** Fakes the tenant-scoped `hrms_app` client `withTenantContext(...)` hands
 * back — `seedCompanyAdmin`/`seedTenantDefaults` only ever touch `.user` and
 * a handful of settings models through it. */
function buildScopedTenantClient(userRows: any[] = []) {
  return {
    user: {
      findFirst: jest.fn().mockResolvedValue(userRows[0] ?? null),
      create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'user-1', ...data })),
    },
    tenantSettings: { create: jest.fn().mockResolvedValue({}) },
    attendanceSettings: { create: jest.fn().mockResolvedValue({}) },
    shift: { create: jest.fn().mockResolvedValue({}) },
    employee: { count: jest.fn().mockResolvedValue(0) },
  };
}

function buildCreateTenantHarness() {
  const scoped = buildScopedTenantClient();
  const tenantPrismaRaw = { $extends: jest.fn().mockReturnValue(scoped) };
  const platformPrisma = {
    tenant: {
      // 1st call: subdomain-uniqueness check (must be null). 2nd call: the
      // final re-fetch after provisioning, once it succeeds.
      findUnique: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ id: 'tenant-1', name: 'Acme', subdomain: 'acme' }),
      create: jest.fn().mockResolvedValue({ id: 'tenant-1', name: 'Acme', subdomain: 'acme' }),
      delete: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    platformAuditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const config = { get: jest.fn().mockReturnValue('fake-web-api-key') };
  const plans = {
    snapshotFor: jest.fn().mockResolvedValue({
      plan: 'STARTER',
      seats: 10,
      enabledModules: [],
      features: {},
      pricePerSeat: { toFixed: () => '99.00' },
      isolationTier: 'POOLED',
    }),
  };
  const firebaseAuth = {
    createUser: jest.fn().mockResolvedValue({ uid: 'fb-uid-1' }),
    setCustomUserClaims: jest.fn().mockResolvedValue(undefined),
  };
  const authEmails = { sendPasswordReset: jest.fn().mockResolvedValue('ses') };
  const service = new PlatformAdminService(
    platformPrisma as any,
    tenantPrismaRaw as any,
    config as any,
    plans as any,
    firebaseAuth as any,
    authEmails as any,
  );
  return { service, platformPrisma, tenantPrismaRaw, scoped, firebaseAuth, authEmails };
}

describe('PlatformAdminService.createTenant — Firebase Admin failure handling', () => {
  const dto = {
    companyName: 'Acme',
    subdomain: 'acme',
    adminEmail: 'admin@acme.test',
    adminName: 'Ada Admin',
  } as any;

  it('turns a Firebase Admin credential failure on createUser into a clear 503, not a raw 500', async () => {
    const { service, platformPrisma, firebaseAuth } = buildCreateTenantHarness();
    firebaseAuth.createUser.mockRejectedValue(
      new Error(
        'Credential implementation provided to initializeApp() ... invalid_grant (Invalid JWT Signature.)',
      ),
    );

    await expect(service.createTenant(dto)).rejects.toBeInstanceOf(ServiceUnavailableException);
    // The half-provisioned tenant row must not survive the failure.
    expect(platformPrisma.tenant.delete).toHaveBeenCalledWith({ where: { id: 'tenant-1' } });
  });

  it('turns a Firebase Admin credential failure on setCustomUserClaims into a clear 503', async () => {
    const { service, platformPrisma, firebaseAuth } = buildCreateTenantHarness();
    firebaseAuth.setCustomUserClaims.mockRejectedValue(
      new Error('invalid_grant (Invalid JWT Signature.)'),
    );

    await expect(service.createTenant(dto)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(platformPrisma.tenant.delete).toHaveBeenCalledWith({ where: { id: 'tenant-1' } });
  });

  it('still rejects a duplicate Firebase email as a 400, not a 503', async () => {
    const { service, firebaseAuth } = buildCreateTenantHarness();
    firebaseAuth.createUser.mockRejectedValue({ code: 'auth/email-already-exists' });

    await expect(service.createTenant(dto)).rejects.toMatchObject({ status: 400 });
  });

  it('creates the tenant admin and emails them a branded INVITE (SES via AuthEmailService)', async () => {
    const { service, authEmails } = buildCreateTenantHarness();

    const result = await service.createTenant(dto);

    expect(result.adminResetEmailSent).toBe(true);
    expect(result.id).toBe('tenant-1');
    expect(authEmails.sendPasswordReset).toHaveBeenCalledWith({
      email: dto.adminEmail,
      kind: 'INVITE',
      tenantId: 'tenant-1',
    });
  });

  it('still creates the tenant when the invite email fails, and says so', async () => {
    const { service, authEmails, platformPrisma } = buildCreateTenantHarness();
    authEmails.sendPasswordReset.mockRejectedValue(new Error('SES throttled'));

    const result = await service.createTenant(dto);

    expect(result.adminResetEmailSent).toBe(false);
    expect(result.id).toBe('tenant-1');
    expect(platformPrisma.tenant.delete).not.toHaveBeenCalled();
  });

  it('resendAdminReset re-sends the INVITE to the first Company Admin', async () => {
    const { service, authEmails, scoped } = buildCreateTenantHarness();
    scoped.user.findFirst.mockResolvedValue({ email: 'owner@acme.test' });

    await expect(service.resendAdminReset('tenant-1')).resolves.toEqual({
      email: 'owner@acme.test',
    });
    expect(authEmails.sendPasswordReset).toHaveBeenCalledWith({
      email: 'owner@acme.test',
      kind: 'INVITE',
      tenantId: 'tenant-1',
    });
  });
});
