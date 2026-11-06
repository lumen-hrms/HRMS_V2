import { ForbiddenException } from '@nestjs/common';
import { isSetupExempt, TenantGuard } from './tenant.guard';

function context(request: Record<string, unknown>, isPublic = false) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(isPublic) };
  const ctx = {
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => request }),
  };
  return { guard: new TenantGuard(reflector as any), ctx: ctx as any };
}

const user = { sub: 'u1', tenantId: 't1', role: 'EMPLOYEE', email: 'e@x', employeeId: 'e1' };

describe('TenantGuard setup gate', () => {
  it('lets every route through once setup is complete', () => {
    const { guard, ctx } = context({
      user,
      tenantId: 't1',
      setupComplete: true,
      originalUrl: '/api/leave/requests',
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('answers SETUP_INCOMPLETE for business routes while setup is incomplete', () => {
    const { guard, ctx } = context({
      user,
      tenantId: 't1',
      setupComplete: false,
      originalUrl: '/api/employees?x=1',
    });
    try {
      guard.canActivate(ctx);
      fail('expected a ForbiddenException');
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect((e as ForbiddenException).getResponse()).toMatchObject({ code: 'SETUP_INCOMPLETE' });
    }
  });

  it('still lets the setup flow, auth and My Account through while incomplete', () => {
    for (const url of ['/api/setup/draft', '/api/setup', '/api/auth/me', '/api/access/me']) {
      const { guard, ctx } = context({
        user,
        tenantId: 't1',
        setupComplete: false,
        originalUrl: url,
      });
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });

  it('checks the tenant match before the setup gate', () => {
    const { guard, ctx } = context({
      user,
      tenantId: 'other',
      setupComplete: false,
      originalUrl: '/api/setup/draft',
    });
    expect(() => guard.canActivate(ctx)).toThrow(
      'Token tenant does not match the requested tenant',
    );
  });
});

describe('isSetupExempt', () => {
  it('matches whole path segments, not look-alike prefixes', () => {
    expect(isSetupExempt('/api/setup/status')).toBe(true);
    expect(isSetupExempt('/api/setupx')).toBe(false);
    expect(isSetupExempt('/api/access/users')).toBe(false);
  });
});
