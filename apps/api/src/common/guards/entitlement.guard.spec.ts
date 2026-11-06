import { ForbiddenException } from '@nestjs/common';
import { EntitlementGuard } from './entitlement.guard';

function buildContext(user: any, handlerMeta: Record<string, unknown> = {}) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => handlerMeta[key]),
  };
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
  return { context, reflector };
}

describe('EntitlementGuard', () => {
  it('allows the request through when no @RequiresModule/@RequiresFeature is set', async () => {
    const { context, reflector } = buildContext({ tenantId: 't1' }, {});
    const platformPrisma = { subscription: { findUnique: jest.fn() } };
    const guard = new EntitlementGuard(reflector as any, platformPrisma as any);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(platformPrisma.subscription.findUnique).not.toHaveBeenCalled();
  });

  it('throws when the tenant has no active subscription row', async () => {
    const { context, reflector } = buildContext(
      { tenantId: 't1' },
      { requiresModule: 'ATTENDANCE' },
    );
    const platformPrisma = { subscription: { findUnique: jest.fn().mockResolvedValue(null) } };
    const guard = new EntitlementGuard(reflector as any, platformPrisma as any);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('blocks when the required module is not in enabledModules', async () => {
    const { context, reflector } = buildContext(
      { tenantId: 't1' },
      { requiresModule: 'ATTENDANCE' },
    );
    const platformPrisma = {
      subscription: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ enabledModules: ['CORE_HR', 'LEAVE'], features: {} }),
      },
    };
    const guard = new EntitlementGuard(reflector as any, platformPrisma as any);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('allows when the required module is in enabledModules', async () => {
    const { context, reflector } = buildContext(
      { tenantId: 't1' },
      { requiresModule: 'ATTENDANCE' },
    );
    const platformPrisma = {
      subscription: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ enabledModules: ['CORE_HR', 'LEAVE', 'ATTENDANCE'], features: {} }),
      },
    };
    const guard = new EntitlementGuard(reflector as any, platformPrisma as any);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('blocks when the required feature flag is off/missing', async () => {
    const { context, reflector } = buildContext(
      { tenantId: 't1' },
      { requiresFeature: 'biometricIntegration' },
    );
    const platformPrisma = {
      subscription: {
        findUnique: jest.fn().mockResolvedValue({ enabledModules: [], features: {} }),
      },
    };
    const guard = new EntitlementGuard(reflector as any, platformPrisma as any);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('allows when the required feature flag is on', async () => {
    const { context, reflector } = buildContext(
      { tenantId: 't1' },
      { requiresFeature: 'biometricIntegration' },
    );
    const platformPrisma = {
      subscription: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ enabledModules: [], features: { biometricIntegration: true } }),
      },
    };
    const guard = new EntitlementGuard(reflector as any, platformPrisma as any);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('throws when there is no tenant on the request', async () => {
    const { context, reflector } = buildContext(undefined, { requiresModule: 'ATTENDANCE' });
    const platformPrisma = { subscription: { findUnique: jest.fn() } };
    const guard = new EntitlementGuard(reflector as any, platformPrisma as any);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });
});
