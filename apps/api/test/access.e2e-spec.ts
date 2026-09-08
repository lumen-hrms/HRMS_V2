import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as admin from 'firebase-admin';
import { createTestApp } from './utils/test-app';
import {
  cleanupTenantFixture,
  deleteTrackedFirebaseUsers,
  createFirebaseTestUser,
  createTenantFixture,
  getIdTokenForEmail,
  superuserPrisma,
  TenantFixture,
} from './utils/fixtures';

/**
 * Identity & Access management module (docs/modules/01_IDENTITY_AND_ACCESS.md).
 * Covers the /api/access/* surface: the RBAC matrix per endpoint, the
 * row-level invariants the guards can't express (privilege ceiling, keep
 * ≥ 1 active Company Admin, no self-deactivation), the append-only login
 * audit trail written by POST /api/auth/session, and tenant isolation of
 * the whole surface.
 */
describe('Identity & Access management (e2e)', () => {
  let app: INestApplication;
  let tenant: TenantFixture;
  let other: TenantFixture;

  // extra logins provisioned directly for this suite (the shared fixture
  // only makes AUDITOR/LINE_MANAGER/EMPLOYEE).
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  async function addUser(role: string, key: string) {
    const email = `${key}+${tenant.subdomain}@example.test`;
    const uid = await createFirebaseTestUser(email, { tenantId: tenant.tenantId, role });
    const user = await superuserPrisma.user.create({
      data: { tenantId: tenant.tenantId, email, firebaseUid: uid, role: role as any },
    });
    ids[key] = user.id;
    tokens[key] = await getIdTokenForEmail(email);
    return { email, uid, id: user.id };
  }

  const server = () => app.getHttpServer();
  const as = (key: string, method: 'get' | 'post' | 'patch', path: string) =>
    (request(server())[method](`/api/access${path}`) as request.Test)
      .set('Authorization', `Bearer ${tokens[key]}`)
      .set('X-Tenant-Subdomain', tenant.subdomain);

  beforeAll(async () => {
    app = await createTestApp();
    [tenant, other] = await Promise.all([
      createTenantFixture('acc'),
      createTenantFixture('acc-other'),
    ]);

    await addUser('COMPANY_ADMIN', 'ca');
    await addUser('COMPANY_ADMIN', 'ca2');
    await addUser('HR_MANAGER', 'hr');
    await addUser('EMPLOYEE', 'emp');
    // A pristine Employee used only as the *acting* principal in "forbidden"
    // checks — never a mutation target, so its token never gets revoked out
    // from under a later assertion.
    await addUser('EMPLOYEE', 'emp2');
    await addUser('AUDITOR', 'aud');

    // Generate one real SUCCESS login-audit row through the actual endpoint.
    await request(server())
      .post('/api/auth/session')
      .set('X-Tenant-Subdomain', tenant.subdomain)
      .send({ idToken: tokens.ca });
  }, 60_000);

  afterAll(async () => {
    await cleanupTenantFixture(tenant.tenantId);
    await cleanupTenantFixture(other.tenantId);
    await deleteTrackedFirebaseUsers();
    await superuserPrisma.$disconnect();
    await app.close();
  });

  // ---- GET /access/users ------------------------------------------------

  describe('GET /users', () => {
    it.each(['ca', 'hr', 'aud'])('allows %s to list tenant logins', async (key) => {
      const res = await as(key, 'get', '/users');
      expect(res.status).toBe(200);
      const emails = res.body.map((u: any) => u.email);
      expect(emails).toEqual(expect.arrayContaining([`ca+${tenant.subdomain}@example.test`]));
      const row = res.body.find((u: any) => u.id === ids.ca);
      expect(row).toMatchObject({ role: 'COMPANY_ADMIN', isActive: true });
      expect(typeof row.firebaseUid).toBe('string');
    });

    it('forbids an Employee', async () => {
      expect((await as('emp2', 'get', '/users')).status).toBe(403);
    });

    it('never leaks another tenant’s logins', async () => {
      const res = await as('ca', 'get', '/users');
      const emails: string[] = res.body.map((u: any) => u.email);
      expect(emails.some((e) => e.includes(other.subdomain))).toBe(false);
    });
  });

  // ---- GET /access/me -------------------------------------------------

  it('GET /me returns the caller’s own identity card + tenant name', async () => {
    const res = await as('emp', 'get', '/me');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ids.emp);
    expect(res.body.email).toBe(`emp+${tenant.subdomain}@example.test`);
    expect(res.body.tenantName).toBe(`E2E acc`);
  });

  // ---- PATCH /access/users/:id/role ----------------------------------

  describe('PATCH /users/:id/role', () => {
    it('forbids an HR Manager (Company Admin only)', async () => {
      const res = await as('hr', 'patch', `/users/${ids.emp}/role`).send({
        newRole: 'LINE_MANAGER',
        reason: 'promoting to team lead',
      });
      expect(res.status).toBe(403);
    });

    it('rejects a reason shorter than 5 chars', async () => {
      const res = await as('ca', 'patch', `/users/${ids.emp}/role`).send({
        newRole: 'LINE_MANAGER',
        reason: 'x',
      });
      expect(res.status).toBe(400);
    });

    it('rejects a no-op role change', async () => {
      const res = await as('ca', 'patch', `/users/${ids.emp}/role`).send({
        newRole: 'EMPLOYEE',
        reason: 'no change at all',
      });
      expect(res.status).toBe(400);
    });

    it('lets a Company Admin change a role, syncs the Firebase claim, writes an audit row', async () => {
      const res = await as('ca', 'patch', `/users/${ids.emp}/role`).send({
        newRole: 'LINE_MANAGER',
        reason: 'promoted to team lead',
      });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('LINE_MANAGER');

      const fb = await admin
        .auth()
        .getUser(
          (await superuserPrisma.user.findUniqueOrThrow({ where: { id: ids.emp } })).firebaseUid,
        );
      expect(fb.customClaims).toMatchObject({ role: 'LINE_MANAGER', tenantId: tenant.tenantId });

      const audit = await as('ca', 'get', '/audit?feed=access');
      expect(
        audit.body.some(
          (r: any) => r.action === 'role.changed' && r.targetEmail.startsWith('emp+'),
        ),
      ).toBe(true);

      // put it back for later tests
      await as('ca', 'patch', `/users/${ids.emp}/role`).send({
        newRole: 'EMPLOYEE',
        reason: 'revert for test isolation',
      });
    });
  });

  // ---- PATCH /access/users/:id/status ------------------------------

  describe('PATCH /users/:id/status', () => {
    it('forbids an Employee', async () => {
      const res = await as('emp2', 'patch', `/users/${ids.hr}/status`).send({
        isActive: false,
        reason: 'should never work',
      });
      expect(res.status).toBe(403);
    });

    it('blocks deactivating your own account', async () => {
      const res = await as('ca', 'patch', `/users/${ids.ca}/status`).send({
        isActive: false,
        reason: 'trying to lock myself out',
      });
      expect(res.status).toBe(400);
    });

    it('lets HR deactivate + reactivate a login and disables the Firebase user', async () => {
      const uid = (await superuserPrisma.user.findUniqueOrThrow({ where: { id: ids.emp } }))
        .firebaseUid;

      const off = await as('hr', 'patch', `/users/${ids.emp}/status`).send({
        isActive: false,
        reason: 'left the company',
      });
      expect(off.status).toBe(200);
      expect(off.body.isActive).toBe(false);
      expect((await admin.auth().getUser(uid)).disabled).toBe(true);

      const on = await as('hr', 'patch', `/users/${ids.emp}/status`).send({
        isActive: true,
        reason: 'rejoined',
      });
      expect(on.status).toBe(200);
      expect(on.body.isActive).toBe(true);
      expect((await admin.auth().getUser(uid)).disabled).toBe(false);
    });

    it('keeps at least one active Company Admin', async () => {
      // ca2 down is fine — ca is still active.
      const first = await as('ca', 'patch', `/users/${ids.ca2}/status`).send({
        isActive: false,
        reason: 'second admin no longer needed',
      });
      expect(first.status).toBe(200);

      // now ca is the only active Company Admin — deactivating ca2's already
      // done, so try to demote/deactivate the last one via ca2 reactivate? No:
      // attempt to deactivate `ca` (by hr) must be blocked.
      const blocked = await as('hr', 'patch', `/users/${ids.ca}/status`).send({
        isActive: false,
        reason: 'removing the last admin',
      });
      expect(blocked.status).toBe(400);

      // and demoting the last active Company Admin's role is blocked too.
      const blockedRole = await as('ca', 'patch', `/users/${ids.ca}/role`).send({
        newRole: 'HR_MANAGER',
        reason: 'demote the last admin',
      });
      expect(blockedRole.status).toBe(400);

      // restore ca2 for cleanliness
      await as('ca', 'patch', `/users/${ids.ca2}/status`).send({
        isActive: true,
        reason: 'restore',
      });
    });
  });

  // ---- POST /access/users/:id/password-reset ---------------------

  describe('POST /users/:id/password-reset', () => {
    it('lets HR trigger a reset for another user', async () => {
      const res = await as('hr', 'post', `/users/${ids.emp}/password-reset`);
      expect(res.status).toBe(201);
      expect(res.body.email).toBe(`emp+${tenant.subdomain}@example.test`);
    });

    it('forbids an Employee', async () => {
      expect((await as('emp2', 'post', `/users/${ids.hr}/password-reset`)).status).toBe(403);
    });
  });

  // ---- GET /access/audit ------------------------------------------

  describe('GET /audit', () => {
    it('records a SUCCESS login for the Company Admin who signed in', async () => {
      const res = await as('ca', 'get', '/audit?feed=login');
      expect(res.status).toBe(200);
      expect(
        res.body.some(
          (r: any) => r.outcome === 'SUCCESS' && r.email === `ca+${tenant.subdomain}@example.test`,
        ),
      ).toBe(true);
    });

    it('records USER_INACTIVE when a still-valid token is exchanged for a deactivated users row', async () => {
      // Deactivate ONLY the DB row (arrange) so the Firebase token still
      // verifies — this is the exact path AuthService.session's users-row
      // check exists for: a valid token, an inactive account.
      // Fresh token: emp may have been revokeRefreshTokens'd by an earlier
      // status test, so re-sign-in to get one with an iat past that.
      const empToken = await getIdTokenForEmail(`emp+${tenant.subdomain}@example.test`);
      await superuserPrisma.user.update({
        where: { id: ids.emp },
        data: { isActive: false },
      });
      const sess = await request(server())
        .post('/api/auth/session')
        .set('X-Tenant-Subdomain', tenant.subdomain)
        .send({ idToken: empToken });
      expect(sess.status).toBe(401);

      const res = await as('aud', 'get', '/audit?feed=login&outcome=USER_INACTIVE');
      expect(
        res.body.some(
          (r: any) =>
            r.outcome === 'USER_INACTIVE' && r.email === `emp+${tenant.subdomain}@example.test`,
        ),
      ).toBe(true);

      await superuserPrisma.user.update({
        where: { id: ids.emp },
        data: { isActive: true },
      });
    });

    it('forbids an HR Manager from reading the audit trail', async () => {
      expect((await as('hr', 'get', '/audit?feed=login')).status).toBe(403);
    });

    it('allows an Auditor (read-only)', async () => {
      expect((await as('aud', 'get', '/audit?feed=access')).status).toBe(200);
    });
  });

  // ---- append-only enforcement ---------------------------------

  it('the app DB role cannot UPDATE or DELETE a login audit row (Postgres-level)', async () => {
    const raw = new PrismaClient({ datasources: { db: { url: process.env.TENANT_DATABASE_URL } } });
    try {
      await expect(
        raw.$executeRawUnsafe(`UPDATE public.login_audit_entries SET outcome = 'SUCCESS'`),
      ).rejects.toThrow(/permission denied/i);
      await expect(raw.$executeRawUnsafe(`DELETE FROM public.login_audit_entries`)).rejects.toThrow(
        /permission denied/i,
      );
      await expect(raw.$executeRawUnsafe(`DELETE FROM public.audit_log`)).rejects.toThrow(
        /permission denied/i,
      );
    } finally {
      await raw.$disconnect();
    }
  });
});
