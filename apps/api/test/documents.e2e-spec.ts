import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
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
 * Module 09 (Documents) — tenant isolation + the DB-level invariants
 * (docs/modules/09_DOCUMENTS.md §11). Document rows are seeded directly
 * (the CI e2e job has no object store); presigning a URL is a local
 * computation, so the download path is still exercised end to end through
 * the guards, the service's scope/scan checks and RLS.
 */
describe('Documents (e2e)', () => {
  let app: INestApplication;
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let docB: string; // CLEAN, tenant B, subject = tenant B's employee
  let pendingB: string; // PENDING_SCAN, same subject
  // The shared fixture's "admin" is an AUDITOR (read-only); Documents'
  // manage routes need a real HR Manager in each tenant.
  const hrEmail: Record<string, string> = {};

  async function addHr(tenant: TenantFixture) {
    const email = `hr+${tenant.subdomain}@example.test`;
    const uid = await createFirebaseTestUser(email, {
      tenantId: tenant.tenantId,
      role: 'HR_MANAGER',
    });
    await superuserPrisma.user.create({
      data: { tenantId: tenant.tenantId, email, firebaseUid: uid, role: 'HR_MANAGER' },
    });
    hrEmail[tenant.tenantId] = email;
  }

  beforeAll(async () => {
    app = await createTestApp();
    [tenantA, tenantB] = await Promise.all([createTenantFixture('da'), createTenantFixture('db')]);
    await Promise.all([addHr(tenantA), addHr(tenantB)]);
    const seed = (scanStatus: 'CLEAN' | 'PENDING_SCAN') =>
      superuserPrisma.document.create({
        data: {
          tenantId: tenantB.tenantId,
          employeeId: tenantB.employeeEmployeeId,
          label: `${scanStatus}.pdf`,
          storageKey: `tenants/${tenantB.tenantId}/employees/${tenantB.employeeEmployeeId}/profile/x.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 10,
          scanStatus,
        },
      });
    docB = (await seed('CLEAN')).id;
    pendingB = (await seed('PENDING_SCAN')).id;
  }, 60_000);

  afterAll(async () => {
    await cleanupTenantFixture(tenantA.tenantId);
    await cleanupTenantFixture(tenantB.tenantId);
    await deleteTrackedFirebaseUsers();
    await superuserPrisma.$disconnect();
    await app.close();
  }, 60_000);

  const server = () => app.getHttpServer();
  async function as(tenant: TenantFixture, email: string) {
    const token = await getIdTokenForEmail(email);
    return (req: request.Test) =>
      req.set('Authorization', `Bearer ${token}`).set('X-Tenant-Subdomain', tenant.subdomain);
  }

  describe('cross-tenant (tenant A HR / Auditor → tenant B document id)', () => {
    it('cannot get a download URL', async () => {
      const auth = await as(tenantA, tenantA.adminEmail);
      const res = await auth(request(server()).get(`/api/documents/${docB}/download-url`));
      expect(res.status).toBe(404);
    });

    it('cannot recategorize', async () => {
      const auth = await as(tenantA, hrEmail[tenantA.tenantId]);
      const res = await auth(
        request(server()).patch(`/api/documents/${docB}/category`).send({ category: 'ID_PROOF' }),
      );
      expect(res.status).toBe(404);
    });

    it('cannot delete', async () => {
      const auth = await as(tenantA, hrEmail[tenantA.tenantId]);
      const res = await auth(request(server()).delete(`/api/documents/${docB}`));
      expect(res.status).toBe(404);
      const row = await superuserPrisma.document.findUniqueOrThrow({ where: { id: docB } });
      expect(row.deletedAt).toBeNull();
    });

    it("cannot list the other tenant's employee's documents", async () => {
      const auth = await as(tenantA, tenantA.adminEmail);
      const res = await auth(
        request(server()).get(`/api/employees/${tenantB.employeeEmployeeId}/documents`),
      );
      expect(res.status).toBe(404);
    });
  });

  describe('within tenant B', () => {
    it('the subject employee gets a short-lived URL and the issue is audited', async () => {
      const auth = await as(tenantB, tenantB.employeeEmail);
      const res = await auth(request(server()).get(`/api/documents/${docB}/download-url`));
      expect(res.status).toBe(200);
      expect(res.body.expiresInSeconds).toBe(300);
      expect(res.body.url).toContain('response-content-disposition=attachment');

      const audit = await superuserPrisma.auditLog.findFirst({
        where: { tenantId: tenantB.tenantId, action: 'documents.downloaded', targetId: docB },
      });
      expect(audit).not.toBeNull();
    });

    it('lists profile documents without leaking the storage key', async () => {
      const auth = await as(tenantB, tenantB.employeeEmail);
      const res = await auth(
        request(server()).get(`/api/employees/${tenantB.employeeEmployeeId}/documents`),
      );
      expect(res.status).toBe(200);
      expect(res.body.map((d: any) => d.id)).toEqual(expect.arrayContaining([docB, pendingB]));
      expect(res.body[0]).not.toHaveProperty('storageKey');
    });

    it('refuses a download URL while the file is still PENDING_SCAN', async () => {
      const auth = await as(tenantB, tenantB.employeeEmail);
      const res = await auth(request(server()).get(`/api/documents/${pendingB}/download-url`));
      expect(res.status).toBe(409);
    });

    it('rejects a spoofed upload (PNG claimed, not PNG bytes) before storage', async () => {
      const auth = await as(tenantB, tenantB.employeeEmail);
      const res = await auth(
        request(server())
          .post(`/api/employees/${tenantB.employeeEmployeeId}/documents`)
          .attach('file', Buffer.from('<script>alert(1)</script>'), {
            filename: 'x.png',
            contentType: 'image/png',
          }),
      );
      expect(res.status).toBe(400);
    });

    it('an Employee cannot delete; HR soft-deletes and the row hides', async () => {
      const employee = await as(tenantB, tenantB.employeeEmail);
      expect((await employee(request(server()).delete(`/api/documents/${pendingB}`))).status).toBe(
        403,
      );

      const admin = await as(tenantB, hrEmail[tenantB.tenantId]);
      expect((await admin(request(server()).delete(`/api/documents/${pendingB}`))).status).toBe(
        200,
      );
      const row = await superuserPrisma.document.findUniqueOrThrow({ where: { id: pendingB } });
      expect(row.deletedAt).not.toBeNull();

      const list = await admin(
        request(server()).get(`/api/employees/${tenantB.employeeEmployeeId}/documents`),
      );
      expect(list.body.map((d: any) => d.id)).not.toContain(pendingB);
    });
  });

  it('the app DB role has no DELETE on documents (RULE-6 — soft delete only)', async () => {
    const rawAppClient = new PrismaClient({
      datasources: { db: { url: process.env.TENANT_DATABASE_URL } },
    });
    try {
      await expect(
        rawAppClient.$executeRawUnsafe('DELETE FROM public.documents WHERE false'),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await rawAppClient.$disconnect();
    }
  });
});
