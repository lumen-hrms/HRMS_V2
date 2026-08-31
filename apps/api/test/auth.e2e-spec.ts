import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { authenticator } from 'otplib';
import { createTestApp } from './utils/test-app';
import {
  cleanupTenantFixture,
  createTenantFixture,
  superuserPrisma,
  TenantFixture,
} from './utils/fixtures';

describe('Auth: MFA + account lockout (e2e)', () => {
  let app: INestApplication;
  let tenant: TenantFixture;

  beforeAll(async () => {
    app = await createTestApp();
    tenant = await createTenantFixture('auth');
    // Promote the fixture's "manager" account to HR_MANAGER so we can drive
    // the MFA-required path end to end.
    await superuserPrisma.user.updateMany({
      where: { tenantId: tenant.tenantId, email: tenant.managerEmail },
      data: { role: 'HR_MANAGER' },
    });
  });

  afterAll(async () => {
    await cleanupTenantFixture(tenant.tenantId);
    await superuserPrisma.$disconnect();
    await app.close();
  });

  const server = () => app.getHttpServer();

  it('requires MFA enrollment on first login for an HR_MANAGER, then issues tokens after a valid TOTP code', async () => {
    const loginRes = await request(server())
      .post('/api/auth/login')
      .set('X-Tenant-Subdomain', tenant.subdomain)
      .send({ email: tenant.managerEmail, password: 'Test-Passw0rd!1' });

    expect(loginRes.body.status).toBe('mfa_enrollment_required');
    expect(typeof loginRes.body.qrCodeDataUrl).toBe('string');

    const payload = JSON.parse(
      Buffer.from(loginRes.body.mfaChallengeToken.split('.')[1], 'base64url').toString(),
    );
    const code = authenticator.generate(payload.secret);

    const verifyRes = await request(server())
      .post('/api/auth/mfa/enroll/verify')
      .set('X-Tenant-Subdomain', tenant.subdomain)
      .send({ mfaChallengeToken: loginRes.body.mfaChallengeToken, code });

    expect(verifyRes.status).toBe(201);
    expect(verifyRes.body.status).toBe('ok');
    expect(typeof verifyRes.body.accessToken).toBe('string');

    // Second login now takes the "already enrolled" MFA path.
    const secondLogin = await request(server())
      .post('/api/auth/login')
      .set('X-Tenant-Subdomain', tenant.subdomain)
      .send({ email: tenant.managerEmail, password: 'Test-Passw0rd!1' });
    expect(secondLogin.body.status).toBe('mfa_required');

    const secondCode = authenticator.generate(payload.secret);
    const secondVerify = await request(server())
      .post('/api/auth/mfa/verify')
      .set('X-Tenant-Subdomain', tenant.subdomain)
      .send({ mfaChallengeToken: secondLogin.body.mfaChallengeToken, code: secondCode });
    expect(secondVerify.body.status).toBe('ok');
  });

  it('rejects a wrong TOTP code', async () => {
    const loginRes = await request(server())
      .post('/api/auth/login')
      .set('X-Tenant-Subdomain', tenant.subdomain)
      .send({ email: tenant.managerEmail, password: 'Test-Passw0rd!1' });

    const res = await request(server())
      .post('/api/auth/mfa/verify')
      .set('X-Tenant-Subdomain', tenant.subdomain)
      .send({ mfaChallengeToken: loginRes.body.mfaChallengeToken, code: '000000' });
    expect(res.status).toBe(401);
  });

  it('locks the account after 5 consecutive failed logins, and a correct password is still rejected during the cooldown', async () => {
    for (let i = 0; i < 5; i++) {
      await request(server())
        .post('/api/auth/login')
        .set('X-Tenant-Subdomain', tenant.subdomain)
        .send({ email: tenant.employeeEmail, password: 'wrong-password' });
    }

    const lockedRes = await request(server())
      .post('/api/auth/login')
      .set('X-Tenant-Subdomain', tenant.subdomain)
      .send({ email: tenant.employeeEmail, password: 'wrong-password' });
    expect(lockedRes.status).toBe(403);
    expect(lockedRes.body.message).toMatch(/locked/i);

    const correctPasswordWhileLocked = await request(server())
      .post('/api/auth/login')
      .set('X-Tenant-Subdomain', tenant.subdomain)
      .send({ email: tenant.employeeEmail, password: 'Test-Passw0rd!1' });
    expect(correctPasswordWhileLocked.status).toBe(403);
  });
});
