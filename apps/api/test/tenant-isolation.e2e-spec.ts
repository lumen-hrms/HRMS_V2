import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './utils/test-app';
import {
  cleanupTenantFixture,
  createTenantFixture,
  superuserPrisma,
  TenantFixture,
  TEST_PASSWORD,
} from './utils/fixtures';

/**
 * This suite is the product's core trust promise made executable: one
 * tenant can never read or write another tenant's data, and the platform
 * operator's own DB role cannot touch tenant business tables AT ALL — not
 * "the API happens not to expose it", but "Postgres itself refuses the
 * query" for the platform role, and "RLS silently returns zero rows" for
 * cross-tenant access even when a request somehow reaches the query layer.
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
    await superuserPrisma.$disconnect();
    await app.close();
  });

  const server = () => app.getHttpServer();

  async function login(subdomain: string, email: string, password = TEST_PASSWORD) {
    const res = await request(server())
      .post('/api/auth/login')
      .set('X-Tenant-Subdomain', subdomain)
      .send({ email, password });
    return res;
  }

  it('logs a tenant admin in and issues a real access token', async () => {
    const res = await login(tenantA.subdomain, tenantA.adminEmail);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.accessToken).toBe('string');
  });

  it('rejects login for a real email under the WRONG tenant subdomain', async () => {
    // tenantA.adminEmail only exists in tenant A's users table; RLS means
    // tenant B's connection literally cannot see that row to compare
    // passwords against, regardless of the WHERE clause the app writes.
    const res = await login(tenantB.subdomain, tenantA.adminEmail);
    expect(res.status).toBe(401);
  });

  it("rejects a tenant A token replayed against tenant B's subdomain", async () => {
    const loginRes = await login(tenantA.subdomain, tenantA.adminEmail);
    const token = loginRes.body.accessToken as string;

    const res = await request(server())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Subdomain', tenantB.subdomain);

    expect(res.status).toBe(403);
  });

  it('never returns tenant B employees to a tenant A session, even by guessed ID', async () => {
    const loginRes = await login(tenantA.subdomain, tenantA.adminEmail);
    const token = loginRes.body.accessToken as string;

    // Correctly scoped: tenant A can see its own employees.
    const ownList = await request(server())
      .get('/api/employees')
      .set('Authorization', `Bearer ${token}`)
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
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Subdomain', tenantA.subdomain);
    expect(directHit.status).toBe(404);
  });

  it('never returns tenant B leave balances to a tenant A session', async () => {
    const loginRes = await login(tenantA.subdomain, tenantA.employeeEmail);
    const token = loginRes.body.accessToken as string;

    const res = await request(server())
      .get(`/api/leave/balances/${tenantB.employeeEmployeeId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Subdomain', tenantA.subdomain);

    // Service-layer scoping rejects it outright (EMPLOYEE can only view
    // their own balances) before RLS even gets a chance to run — either
    // way, tenant B's data is inaccessible.
    expect([403, 404]).toContain(res.status);
  });

  it('blocks writes into tenant B via tenant A session (leave approval across tenants)', async () => {
    const loginRes = await login(tenantA.subdomain, tenantA.managerEmail);
    const token = loginRes.body.accessToken as string;

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
      .set('Authorization', `Bearer ${token}`)
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
