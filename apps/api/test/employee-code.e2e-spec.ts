import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  cleanupTenantFixture,
  createFirebaseTestUser,
  createTenantFixture,
  deleteTrackedFirebaseUsers,
  getIdTokenForEmail,
  superuserPrisma,
  TenantFixture,
} from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * GET /api/employees/code-available — the live "does this employee code
 * already exist?" check on the Add employee form. HR/Admin only, scoped to the
 * caller's tenant, exact match (like the unique index).
 */
describe('Employee code availability (e2e)', () => {
  let app: INestApplication;
  let tenant: TenantFixture;
  let other: TenantFixture;
  let hrToken: string;
  let employeeToken: string;

  const check = (token: string, t: TenantFixture, code?: string) =>
    request(app.getHttpServer())
      .get('/api/employees/code-available')
      .query(code === undefined ? {} : { code })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Subdomain', t.subdomain);

  beforeAll(async () => {
    app = await createTestApp();
    [tenant, other] = await Promise.all([
      createTenantFixture('code'),
      createTenantFixture('code-other'),
    ]);
    const hrEmail = `hr+${tenant.subdomain}@example.test`;
    const uid = await createFirebaseTestUser(hrEmail, {
      tenantId: tenant.tenantId,
      role: 'HR_MANAGER',
    });
    await superuserPrisma.user.create({
      data: { tenantId: tenant.tenantId, email: hrEmail, firebaseUid: uid, role: 'HR_MANAGER' },
    });
    hrToken = await getIdTokenForEmail(hrEmail);
    employeeToken = await getIdTokenForEmail(tenant.employeeEmail);
  }, 60_000);

  afterAll(async () => {
    await cleanupTenantFixture(tenant.tenantId);
    await cleanupTenantFixture(other.tenantId);
    await deleteTrackedFirebaseUsers();
    await superuserPrisma.$disconnect();
    await app.close();
  }, 60_000);

  it('says a code that exists is not available', async () => {
    const res = await check(hrToken, tenant, `${tenant.subdomain}-EMP`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false });
  });

  it('says a new code is available, ignoring surrounding spaces', async () => {
    const res = await check(hrToken, tenant, '  BRAND-NEW-1 ');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true });
  });

  it('matches exactly: a different letter case is a different code', async () => {
    const res = await check(hrToken, tenant, `${tenant.subdomain}-emp`);
    expect(res.body).toEqual({ available: true });
  });

  it('rejects a missing or blank code', async () => {
    expect((await check(hrToken, tenant)).status).toBe(400);
    expect((await check(hrToken, tenant, '   ')).status).toBe(400);
  });

  it('is for HR/Admin only — an Employee gets 403', async () => {
    expect((await check(employeeToken, tenant, 'ANY')).status).toBe(403);
  });

  it('never sees another tenant’s employees: their code is free here', async () => {
    const res = await check(hrToken, tenant, `${other.subdomain}-EMP`);
    expect(res.body).toEqual({ available: true });
  });
});
