import { HttpException } from '@nestjs/common';
import {
  PasswordResetLimiter,
  PasswordResetService,
  WindowLimiter,
} from './password-reset.service';

function build(
  user: { email: string } | null = { email: 'Asha@Acme.test' },
  limiter = new PasswordResetLimiter(),
) {
  const tenantPrisma = {
    tenantId: 'tenant-1',
    client: { user: { findFirst: jest.fn().mockResolvedValue(user) } },
  };
  const authEmails = { sendPasswordReset: jest.fn().mockResolvedValue('ses') };
  const service = new PasswordResetService(tenantPrisma as any, authEmails as any, limiter);
  return { service, tenantPrisma, authEmails };
}

describe('PasswordResetService.request', () => {
  it('emails an active user in this tenant (case-insensitive lookup)', async () => {
    const { service, tenantPrisma, authEmails } = build();

    await service.request('  ASHA@acme.test ', '1.2.3.4');

    expect(tenantPrisma.client.user.findFirst).toHaveBeenCalledWith({
      where: { email: { equals: 'asha@acme.test', mode: 'insensitive' }, isActive: true },
      select: { email: true },
    });
    expect(authEmails.sendPasswordReset).toHaveBeenCalledWith({
      email: 'Asha@Acme.test',
      kind: 'SELF_SERVICE',
      tenantId: 'tenant-1',
    });
  });

  it('silently does nothing for an unknown or inactive account (no enumeration)', async () => {
    const { service, authEmails } = build(null);
    await expect(service.request('nobody@acme.test', '1.2.3.4')).resolves.toBeUndefined();
    expect(authEmails.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('swallows a send failure — same response as success', async () => {
    const { service, authEmails } = build();
    authEmails.sendPasswordReset.mockRejectedValue(new Error('SES down'));
    await expect(service.request('asha@acme.test', '1.2.3.4')).resolves.toBeUndefined();
  });

  it('caps sends per email at 3 per window, silently', async () => {
    const { service, authEmails } = build();
    for (let i = 0; i < 5; i++) await service.request('asha@acme.test', `10.0.0.${i}`);
    expect(authEmails.sendPasswordReset).toHaveBeenCalledTimes(3);
  });

  it('limits across requests — Nest builds a new service per request, the limiter is shared', async () => {
    const shared = new PasswordResetLimiter();
    const sends: jest.Mock[] = [];
    for (let i = 0; i < 5; i++) {
      // A fresh service each time, exactly like request scope does.
      const { service, authEmails } = build({ email: 'asha@acme.test' }, shared);
      await service.request('asha@acme.test', `10.0.0.${i}`);
      sends.push(authEmails.sendPasswordReset);
    }
    expect(sends.filter((s) => s.mock.calls.length > 0)).toHaveLength(3);
  });

  it('answers 429 once one IP exceeds 10 requests per window', async () => {
    const { service } = build(null);
    for (let i = 0; i < 10; i++) await service.request(`u${i}@acme.test`, '9.9.9.9');
    await expect(service.request('u11@acme.test', '9.9.9.9')).rejects.toBeInstanceOf(HttpException);
    await expect(service.request('u11@acme.test', '9.9.9.9')).rejects.toMatchObject({
      status: 429,
    });
  });
});

describe('WindowLimiter', () => {
  it('resets after the window', () => {
    const limiter = new WindowLimiter(1, 1000);
    expect(limiter.take('k', 0)).toBe(true);
    expect(limiter.take('k', 500)).toBe(false);
    expect(limiter.take('k', 1001)).toBe(true);
  });
});
