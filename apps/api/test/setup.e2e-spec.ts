import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import {
  cleanupTenantFixture,
  createFirebaseTestUser,
  createTenantFixture,
  deleteTrackedFirebaseUsers,
  getIdTokenForEmail,
  superuserPrisma,
  TenantFixture,
} from './utils/fixtures';

/**
 * Company setup gate (module 13): while a tenant's setup is incomplete,
 * every business route answers SETUP_INCOMPLETE for every role — enforced in
 * `TenantGuard`, not just hidden in the UI — while the setup flow and the
 * session endpoints keep working. Another tenant is unaffected, and one
 * tenant's Company Admin can never read another tenant's draft.
 */
describe('Company setup gate (e2e)', () => {
  let app: INestApplication;
  let pending: TenantFixture;
  let done: TenantFixture;
  let pendingAdminEmail: string;
  let doneAdminEmail: string;

  const server = () => app.getHttpServer();
  const get = (path: string, token: string, subdomain: string) =>
    request(server())
      .get(path)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Subdomain', subdomain);

  async function addCompanyAdmin(t: TenantFixture) {
    const email = `ca+${t.subdomain}@example.test`;
    const uid = await createFirebaseTestUser(email, {
      tenantId: t.tenantId,
      role: 'COMPANY_ADMIN',
    });
    await superuserPrisma.user.create({
      data: { tenantId: t.tenantId, email, firebaseUid: uid, role: 'COMPANY_ADMIN' },
    });
    return email;
  }

  beforeAll(async () => {
    app = await createTestApp();
    [pending, done] = await Promise.all([
      createTenantFixture('setup-pending'),
      createTenantFixture('setup-done'),
    ]);
    // Fixture tenants start set up; put this one back into setup.
    await superuserPrisma.tenantSetup.update({
      where: { tenantId: pending.tenantId },
      data: { completedAt: null },
    });
    [pendingAdminEmail, doneAdminEmail] = await Promise.all([
      addCompanyAdmin(pending),
      addCompanyAdmin(done),
    ]);
  }, 60_000);

  afterAll(async () => {
    await cleanupTenantFixture(pending.tenantId);
    await cleanupTenantFixture(done.tenantId);
    await deleteTrackedFirebaseUsers();
    await superuserPrisma.$disconnect();
    await app.close();
  }, 60_000);

  it('refuses business routes for every role while setup is incomplete', async () => {
    for (const email of [pending.employeeEmail, pendingAdminEmail]) {
      const token = await getIdTokenForEmail(email);
      for (const path of ['/api/employees', '/api/leave/types', '/api/attendance/settings']) {
        const res = await get(path, token, pending.subdomain);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('SETUP_INCOMPLETE');
      }
    }
  });

  it('keeps the setup status, identity and the admin’s draft reachable', async () => {
    const employeeToken = await getIdTokenForEmail(pending.employeeEmail);
    const status = await get('/api/setup/status', employeeToken, pending.subdomain);
    expect(status.status).toBe(200);
    expect(status.body.complete).toBe(false);
    expect((await get('/api/auth/me', employeeToken, pending.subdomain)).status).toBe(200);

    const adminToken = await getIdTokenForEmail(pendingAdminEmail);
    const draft = await get('/api/setup/draft', adminToken, pending.subdomain);
    expect(draft.status).toBe(200);
    expect(draft.body.draft.version).toBe(1);
  });

  it('only lets a Company Admin touch the draft', async () => {
    const employeeToken = await getIdTokenForEmail(pending.employeeEmail);
    expect((await get('/api/setup/draft', employeeToken, pending.subdomain)).status).toBe(403);
  });

  it('leaves a set-up tenant unaffected', async () => {
    const token = await getIdTokenForEmail(done.employeeEmail);
    expect((await get('/api/employees', token, done.subdomain)).status).toBe(200);
    const status = await get('/api/setup/status', token, done.subdomain);
    expect(status.body.complete).toBe(true);
  });

  it('never lets one tenant’s Company Admin read another tenant’s draft', async () => {
    const otherAdminToken = await getIdTokenForEmail(doneAdminEmail);
    const res = await get('/api/setup/draft', otherAdminToken, pending.subdomain);
    expect(res.status).toBe(403); // token tenant ≠ requested tenant
  });
});
