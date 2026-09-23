import { AuthEmailService, authEmailBody } from './auth-email.service';
import * as resetModule from '../firebase/send-reset-email';

jest.mock('../firebase/send-reset-email', () => ({
  sendFirebasePasswordResetEmail: jest.fn().mockResolvedValue(undefined),
}));

const LINK = 'https://lumen-307b1.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=abc';

function build({ configured = true } = {}) {
  const sender = { isConfigured: configured, send: jest.fn().mockResolvedValue('ses-msg-1') };
  const config = {
    get: jest.fn((key: string) =>
      key === 'appBaseUrl' ? 'https://www.lumenhrms.work' : 'web-api-key',
    ),
  };
  const firebaseAuth = { generatePasswordResetLink: jest.fn().mockResolvedValue(LINK) };
  const platformPrisma = {
    tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'Acme Hospital' }) },
  };
  const service = new AuthEmailService(
    sender as any,
    config as any,
    firebaseAuth as any,
    platformPrisma as any,
  );
  return { service, sender, firebaseAuth, platformPrisma };
}

describe('AuthEmailService.sendPasswordReset', () => {
  beforeEach(() => jest.clearAllMocks());

  it('generates a Firebase reset link returning to /login and sends it via SES under the tenant name', async () => {
    const { service, sender, firebaseAuth, platformPrisma } = build();

    await expect(
      service.sendPasswordReset({ email: 'asha@acme.test', kind: 'INVITE', tenantId: 't-1' }),
    ).resolves.toBe('ses');

    expect(platformPrisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: 't-1' },
      select: { name: true },
    });
    expect(firebaseAuth.generatePasswordResetLink).toHaveBeenCalledWith('asha@acme.test', {
      url: 'https://www.lumenhrms.work/login',
    });
    const sent = sender.send.mock.calls[0][0];
    expect(sent).toMatchObject({
      to: 'asha@acme.test',
      fromName: 'Acme Hospital via Lumen HRMS',
      subject: "You're invited to Acme Hospital on Lumen HRMS",
    });
    // The link is the CTA as-is — not prefixed with the app URL.
    expect(sent.text).toContain(`Set your password: ${LINK}`);
    expect(sent.html).toContain(`href="${LINK.replace(/&/g, '&amp;')}"`);
    expect(resetModule.sendFirebasePasswordResetEmail).not.toHaveBeenCalled();
  });

  it("falls back to a plain link when the app domain isn't authorized in Firebase", async () => {
    const { service, firebaseAuth, sender } = build();
    firebaseAuth.generatePasswordResetLink
      .mockRejectedValueOnce(
        Object.assign(new Error('nope'), { code: 'auth/unauthorized-continue-uri' }),
      )
      .mockResolvedValueOnce(LINK);

    await service.sendPasswordReset({ email: 'a@b.test', kind: 'SELF_SERVICE', tenantId: 't-1' });

    expect(firebaseAuth.generatePasswordResetLink).toHaveBeenLastCalledWith('a@b.test');
    expect(sender.send).toHaveBeenCalled();
  });

  it('propagates other Firebase errors (e.g. no such user) without sending', async () => {
    const { service, firebaseAuth, sender } = build();
    firebaseAuth.generatePasswordResetLink.mockRejectedValue(
      Object.assign(new Error('no user'), { code: 'auth/user-not-found' }),
    );
    await expect(
      service.sendPasswordReset({ email: 'x@b.test', kind: 'ADMIN_RESET', tenantId: 't-1' }),
    ).rejects.toThrow('no user');
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('propagates an SES failure so the caller can report it', async () => {
    const { service, sender } = build();
    sender.send.mockRejectedValue(new Error('MessageRejected'));
    await expect(
      service.sendPasswordReset({ email: 'a@b.test', kind: 'INVITE', tenantId: 't-1' }),
    ).rejects.toThrow('MessageRejected');
  });

  it("uses Firebase's own reset email when SES isn't configured", async () => {
    const { service, sender, firebaseAuth } = build({ configured: false });

    await expect(
      service.sendPasswordReset({ email: 'a@b.test', kind: 'INVITE', tenantId: 't-1' }),
    ).resolves.toBe('firebase');

    expect(resetModule.sendFirebasePasswordResetEmail).toHaveBeenCalledWith(
      'web-api-key',
      'a@b.test',
    );
    expect(firebaseAuth.generatePasswordResetLink).not.toHaveBeenCalled();
    expect(sender.send).not.toHaveBeenCalled();
  });
});

describe('authEmailBody', () => {
  it.each([
    ['INVITE', /invited to Acme/, 'Set your password'],
    ['ADMIN_RESET', /Reset your Acme password/, 'Set a new password'],
    ['SELF_SERVICE', /Reset your Acme password/, 'Reset password'],
  ] as const)('%s has its own subject and call to action', (kind, subject, cta) => {
    const body = authEmailBody(kind, 'Acme', LINK);
    expect(body.subject).toMatch(subject);
    expect(body.cta).toEqual({ label: cta, path: LINK });
  });
});
