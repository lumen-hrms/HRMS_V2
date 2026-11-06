import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import {
  cleanupTenantFixture,
  deleteTrackedFirebaseUsers,
  createTenantFixture,
  getIdTokenForEmail,
  superuserPrisma,
  TenantFixture,
} from './utils/fixtures';

/**
 * MFA is gone (see CLAUDE.md / the Firebase migration plan) — Firebase's
 * own ID token is the entire session artifact, so this suite is now just
 * "does POST /auth/session correctly gate on token validity and account
 * state." Tenant-crossing behavior is covered separately in
 * tenant-isolation.e2e-spec.ts.
 */
describe('Auth: session exchange (e2e)', () => {
  let app: INestApplication;
  let tenant: TenantFixture;

  beforeAll(async () => {
    app = await createTestApp();
    tenant = await createTenantFixture('auth');
  }, 60_000);

  afterAll(async () => {
    await cleanupTenantFixture(tenant.tenantId);
    await deleteTrackedFirebaseUsers();
    await superuserPrisma.$disconnect();
    await app.close();
  }, 60_000);

  const server = () => app.getHttpServer();

  it('exchanges a valid Firebase ID token for an active session', async () => {
    const idToken = await getIdTokenForEmail(tenant.adminEmail);

    const res = await request(server())
      .post('/api/auth/session')
      .set('X-Tenant-Subdomain', tenant.subdomain)
      .send({ idToken });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ok');
    expect(res.body.user.email).toBe(tenant.adminEmail);
    expect(res.body.user.tenantId).toBe(tenant.tenantId);
  });

  it('rejects an inactive account even with a valid token', async () => {
    await superuserPrisma.user.updateMany({
      where: { tenantId: tenant.tenantId, email: tenant.employeeEmail },
      data: { isActive: false },
    });

    const idToken = await getIdTokenForEmail(tenant.employeeEmail);
    const res = await request(server())
      .post('/api/auth/session')
      .set('X-Tenant-Subdomain', tenant.subdomain)
      .send({ idToken });

    expect(res.status).toBe(401);

    await superuserPrisma.user.updateMany({
      where: { tenantId: tenant.tenantId, email: tenant.employeeEmail },
      data: { isActive: true },
    });
  });

  it('rejects a tampered/garbage token', async () => {
    const res = await request(server())
      .post('/api/auth/session')
      .set('X-Tenant-Subdomain', tenant.subdomain)
      .send({ idToken: 'not-a-real-token' });

    expect(res.status).toBe(401);
  });

  describe('POST /api/auth/password-reset (self-service, pre-auth)', () => {
    const reset = (email: unknown, subdomain = tenant.subdomain) =>
      request(server())
        .post('/api/auth/password-reset')
        .set('X-Tenant-Subdomain', subdomain)
        .send({ email });

    it('answers 202 without a token — and identically for an unknown email (no enumeration)', async () => {
      const unknown = await reset('nobody-here@example.test');
      expect(unknown.status).toBe(202);
      expect(unknown.body).toEqual({ status: 'ok' });
    });

    it('rejects a malformed email (400)', async () => {
      expect((await reset('not-an-email')).status).toBe(400);
    });

    it('404s for a workspace that does not exist', async () => {
      expect((await reset('a@example.test', 'no-such-tenant-e2e')).status).toBe(404);
    });
  });
});
