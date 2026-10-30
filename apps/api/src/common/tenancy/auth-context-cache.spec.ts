import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  TtlCache,
  authUserByUid,
  clearAuthContextCaches,
  invalidateOnIdentityWrites,
  setupCompleteByTenant,
  tenantBySubdomain,
} from './auth-context-cache';
import { TenantResolutionMiddleware } from './tenant-resolution.middleware';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

const TENANT = { id: 't-1', subdomain: 'acme', name: 'Acme', status: 'ACTIVE' };
const USER = {
  id: 'u-1',
  role: 'HR_MANAGER',
  email: 'hr@acme.test',
  isActive: true,
  employeeId: 'e-1',
};

beforeEach(() => clearAuthContextCaches());

describe('TtlCache', () => {
  it('returns a value until its TTL passes, then forgets it', () => {
    let now = 1_000;
    const cache = new TtlCache<string>(30_000, () => now);
    cache.set('k', 'v');
    now += 29_999;
    expect(cache.get('k')).toBe('v');
    now += 1;
    expect(cache.get('k')).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});

describe('invalidateOnIdentityWrites', () => {
  const run = (model: string, action: string, args: Record<string, unknown> = {}) =>
    invalidateOnIdentityWrites()({ model, action, args } as any, async () => 'ok');

  beforeEach(() => {
    tenantBySubdomain.set('acme', TENANT);
    authUserByUid.set('t-1:uid-1', USER);
    setupCompleteByTenant.set('t-1', true);
  });

  it('clears tenants on a tenant write (suspend / read-only / resume)', async () => {
    await run('Tenant', 'update', { data: { status: 'SUSPENDED' } });
    expect(tenantBySubdomain.get('acme')).toBeUndefined();
    expect(authUserByUid.get('t-1:uid-1')).toEqual(USER);
  });

  it('clears users on a user write (deactivate / role change)', async () => {
    await run('User', 'update', { data: { isActive: false } });
    expect(authUserByUid.get('t-1:uid-1')).toBeUndefined();
    expect(tenantBySubdomain.get('acme')).toEqual(TENANT);
  });

  it('clears users when an employee is linked to or unlinked from a login', async () => {
    await run('Employee', 'update', { data: { userId: 'u-1' } });
    expect(authUserByUid.get('t-1:uid-1')).toBeUndefined();
  });

  it('keeps users on an ordinary employee edit', async () => {
    await run('Employee', 'update', { data: { designation: 'Lead' } });
    expect(authUserByUid.get('t-1:uid-1')).toEqual(USER);
  });

  it('clears setup status when setup is written', async () => {
    await run('TenantSetup', 'update', { data: { completedAt: null } });
    expect(setupCompleteByTenant.get('t-1')).toBeUndefined();
  });

  it('ignores reads', async () => {
    await run('User', 'findUnique');
    await run('Tenant', 'findMany');
    expect(authUserByUid.get('t-1:uid-1')).toEqual(USER);
    expect(tenantBySubdomain.get('acme')).toEqual(TENANT);
  });
});

describe('TenantResolutionMiddleware (cached)', () => {
  function build(row: unknown) {
    const platformPrisma = { tenant: { findUnique: jest.fn().mockResolvedValue(row) } };
    const config = { get: jest.fn().mockReturnValue('header') };
    return {
      middleware: new TenantResolutionMiddleware(platformPrisma as any, config as any),
      findUnique: platformPrisma.tenant.findUnique,
    };
  }
  const req = () =>
    ({
      header: (h: string) => (h === 'x-tenant-subdomain' ? 'acme' : undefined),
      method: 'GET',
      originalUrl: '/api/x',
    }) as any;

  it('looks a tenant up once, then serves it from the cache', async () => {
    const { middleware, findUnique } = build(TENANT);
    const next = jest.fn();
    const r1 = req();
    const r2 = req();
    await middleware.use(r1, {} as any, next);
    await middleware.use(r2, {} as any, next);
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(r2.tenantId).toBe('t-1');
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('still refuses a suspended tenant served from the cache', async () => {
    tenantBySubdomain.set('acme', { ...TENANT, status: 'SUSPENDED' });
    const { middleware, findUnique } = build(TENANT);
    await expect(middleware.use(req(), {} as any, jest.fn())).rejects.toThrow(ForbiddenException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('does not cache an unknown subdomain', async () => {
    const { middleware, findUnique } = build(null);
    await expect(middleware.use(req(), {} as any, jest.fn())).rejects.toThrow();
    await expect(middleware.use(req(), {} as any, jest.fn())).rejects.toThrow();
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});

describe('JwtAuthGuard (cached)', () => {
  function build(userRow: unknown, setupRow: unknown) {
    const user = { findUnique: jest.fn().mockResolvedValue(userRow) };
    const tenantSetup = { findUnique: jest.fn().mockResolvedValue(setupRow) };
    const raw = {
      $extends: () => ({ user, tenantSetup }),
    };
    const firebaseAuth = {
      verifyIdToken: jest
        .fn()
        .mockResolvedValue({ uid: 'uid-1', tenantId: 't-1', role: 'HR_MANAGER' }),
    };
    const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
    return {
      guard: new JwtAuthGuard(reflector, firebaseAuth as any, raw as any),
      user,
      tenantSetup,
    };
  }
  function ctx() {
    const request: any = { headers: { authorization: 'Bearer tok' }, header: () => undefined };
    return {
      request,
      context: {
        getHandler: () => null,
        getClass: () => null,
        switchToHttp: () => ({ getRequest: () => request }),
      } as any,
    };
  }
  const ROW = {
    id: 'u-1',
    role: 'HR_MANAGER',
    email: 'hr@acme.test',
    isActive: true,
    employee: { id: 'e-1' },
  };

  it('reads the user and a finished setup once, then from the cache', async () => {
    const { guard, user, tenantSetup } = build(ROW, { completedAt: new Date() });
    await guard.canActivate(ctx().context);
    const second = ctx();
    await guard.canActivate(second.context);
    expect(user.findUnique).toHaveBeenCalledTimes(1);
    expect(tenantSetup.findUnique).toHaveBeenCalledTimes(1);
    expect(second.request.user).toEqual({
      sub: 'u-1',
      tenantId: 't-1',
      role: 'HR_MANAGER',
      email: 'hr@acme.test',
      employeeId: 'e-1',
    });
    expect(second.request.setupComplete).toBe(true);
  });

  it('never caches an unfinished setup', async () => {
    const { guard, tenantSetup } = build(ROW, { completedAt: null });
    await guard.canActivate(ctx().context);
    const second = ctx();
    await guard.canActivate(second.context);
    expect(tenantSetup.findUnique).toHaveBeenCalledTimes(2);
    expect(second.request.setupComplete).toBe(false);
  });

  it('refuses a deactivated user, and re-reads after a user write clears the cache', async () => {
    const { guard, user } = build(ROW, { completedAt: new Date() });
    await guard.canActivate(ctx().context);
    await invalidateOnIdentityWrites()(
      { model: 'User', action: 'update', args: {} } as any,
      async () => 'ok',
    );
    user.findUnique.mockResolvedValue({ ...ROW, isActive: false });
    await expect(guard.canActivate(ctx().context)).rejects.toThrow('Account not found or inactive');
    expect(user.findUnique).toHaveBeenCalledTimes(2);
  });
});
