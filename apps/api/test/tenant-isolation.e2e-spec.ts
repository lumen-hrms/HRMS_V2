import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
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
 * This suite is the product's core trust promise made executable: one
 * tenant can never read or write another tenant's data, and the platform
 * operator's own DB role cannot touch tenant business tables AT ALL — not
 * "the API happens not to expose it", but "Postgres itself refuses the
 * query" for the platform role, and "RLS silently returns zero rows" for
 * cross-tenant access even when a request somehow reaches the query layer.
 *
 * Identity is Firebase Auth now (see fixtures.ts): every test signs in
 * against the Firebase Auth Emulator to get a real, verifiable ID token —
 * the same artifact `JwtAuthGuard`/`AuthService.session` verify in
 * production — and sends it as `Authorization: Bearer <idToken>`.
 */
describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;

  beforeAll(async () => {
    app = await createTestApp();
    [tenantA, tenantB] = await Promise.all([createTenantFixture('a'), createTenantFixture('b')]);
  });

  afterAll(async () => {
    await cleanupTenantFixture(tenantA.tenantId);
    await cleanupTenantFixture(tenantB.tenantId);
    await deleteTrackedFirebaseUsers();
    await superuserPrisma.$disconnect();
    await app.close();
  });

  const server = () => app.getHttpServer();

  async function createSession(subdomain: string, email: string) {
    const idToken = await getIdTokenForEmail(email);
    const res = await request(server())
      .post('/api/auth/session')
      .set('X-Tenant-Subdomain', subdomain)
      .send({ idToken });
    return { res, idToken };
  }

  it('confirms a session for a tenant user signed in with Firebase', async () => {
    const { res } = await createSession(tenantA.subdomain, tenantA.adminEmail);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ok');
    expect(res.body.user.tenantId).toBe(tenantA.tenantId);
  });

  it('rejects session confirmation for a real account under the WRONG tenant subdomain', async () => {
    // tenantA.adminEmail's Firebase account carries a tenantId custom claim
    // for tenant A; presenting that (validly signed) token against tenant
    // B's subdomain must be rejected by AuthService.session's tenantId
    // cross-check, independent of Firebase's own (tenant-agnostic) sign-in.
    const { res } = await createSession(tenantB.subdomain, tenantA.adminEmail);
    expect(res.status).toBe(401);
  });

  it("rejects a tenant A token replayed against tenant B's subdomain", async () => {
    const idToken = await getIdTokenForEmail(tenantA.adminEmail);

    const res = await request(server())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${idToken}`)
      .set('X-Tenant-Subdomain', tenantB.subdomain);

    expect(res.status).toBe(403);
  });

  it('never returns tenant B employees to a tenant A session, even by guessed ID', async () => {
    const idToken = await getIdTokenForEmail(tenantA.adminEmail);

    // Correctly scoped: tenant A can see its own employees.
    const ownList = await request(server())
      .get('/api/employees')
      .set('Authorization', `Bearer ${idToken}`)
      .set('X-Tenant-Subdomain', tenantA.subdomain);
    expect(ownList.status).toBe(200);
    const ids = ownList.body.map((e: any) => e.id);
    expect(ids).toContain(tenantA.adminEmployeeId);
    expect(ids).not.toContain(tenantB.adminEmployeeId);

    // Directly requesting tenant B's employee id, while authenticated (and
    // tenant-header-matched) as tenant A, must 404 — RLS filters the row
    // out before it ever reaches the controller's "not found" branch.
    const directHit = await request(server())
      .get(`/api/employees/${tenantB.adminEmployeeId}`)
      .set('Authorization', `Bearer ${idToken}`)
      .set('X-Tenant-Subdomain', tenantA.subdomain);
    expect(directHit.status).toBe(404);
  });

  it('never returns tenant B leave balances to a tenant A session', async () => {
    const idToken = await getIdTokenForEmail(tenantA.employeeEmail);

    const res = await request(server())
      .get(`/api/leave/balances/${tenantB.employeeEmployeeId}`)
      .set('Authorization', `Bearer ${idToken}`)
      .set('X-Tenant-Subdomain', tenantA.subdomain);

    // Service-layer scoping rejects it outright (EMPLOYEE can only view
    // their own balances) before RLS even gets a chance to run — either
    // way, tenant B's data is inaccessible.
    expect([403, 404]).toContain(res.status);
  });

  it('blocks writes into tenant B via tenant A session (leave approval across tenants)', async () => {
    const idToken = await getIdTokenForEmail(tenantA.managerEmail);

    // Create a leave request that actually belongs to tenant B, using the
    // superuser fixture connection (arrange step, not part of what's under
    // test), then try to approve it as tenant A's manager.
    const leaveType = await superuserPrisma.leaveType.create({
      data: { tenantId: tenantB.tenantId, name: 'E2E Leave', annualQuota: 10 },
    });
    const leaveRequest = await superuserPrisma.leaveRequest.create({
      data: {
        tenantId: tenantB.tenantId,
        employeeId: tenantB.employeeEmployeeId,
        leaveTypeId: leaveType.id,
        startDate: new Date(),
        endDate: new Date(),
        days: 1,
        status: 'PENDING_L1',
      },
    });

    const res = await request(server())
      .post(`/api/leave/requests/${leaveRequest.id}/approve`)
      .set('Authorization', `Bearer ${idToken}`)
      .set('X-Tenant-Subdomain', tenantA.subdomain);

    // RLS makes the row invisible under tenant A's session, so Prisma's
    // findUniqueOrThrow inside LeaveService.approve throws -> the request
    // is rejected. It must NOT come back 200/APPROVED.
    expect(res.status).not.toBe(200);

    const stillPending = await superuserPrisma.leaveRequest.findUnique({
      where: { id: leaveRequest.id },
    });
    expect(stillPending?.status).toBe('PENDING_L1');
  });

  it('fails closed: hrms_app connection with no tenant context set sees zero rows', async () => {
    const rawAppClient = new PrismaClient({
      datasources: { db: { url: process.env.TENANT_DATABASE_URL } },
    });
    try {
      // Deliberately do NOT call set_config first.
      const count = await rawAppClient.user.count();
      expect(count).toBe(0);
    } finally {
      await rawAppClient.$disconnect();
    }
  });

  it('the platform DB role cannot query tenant business tables at all (Postgres-level, not app-level)', async () => {
    const rawPlatformClient = new PrismaClient({
      datasources: { db: { url: process.env.PLATFORM_DATABASE_URL } },
    });
    try {
      await expect(
        rawPlatformClient.$queryRawUnsafe('SELECT * FROM public.employees LIMIT 1'),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        rawPlatformClient.$queryRawUnsafe('SELECT * FROM public.users LIMIT 1'),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await rawPlatformClient.$disconnect();
    }
  });

  it('fails closed on the new leave tables too: no tenant context set sees zero rows', async () => {
    const rawAppClient = new PrismaClient({
      datasources: { db: { url: process.env.TENANT_DATABASE_URL } },
    });
    try {
      // Deliberately do NOT call set_config first — mirrors the `users`
      // check above for the two tables this module added (leave_approvals,
      // leave_ledger_entries): RLS must fail closed on these exactly the
      // same way it does on every other tenant table.
      expect(await rawAppClient.leaveApproval.count()).toBe(0);
      expect(await rawAppClient.leaveLedgerEntry.count()).toBe(0);
    } finally {
      await rawAppClient.$disconnect();
    }
  });

  it('the tenant app DB role cannot query platform tables at all', async () => {
    const rawAppClient = new PrismaClient({
      datasources: { db: { url: process.env.TENANT_DATABASE_URL } },
    });
    try {
      await expect(
        rawAppClient.$queryRawUnsafe('SELECT * FROM platform.tenants LIMIT 1'),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await rawAppClient.$disconnect();
    }
  });
});
