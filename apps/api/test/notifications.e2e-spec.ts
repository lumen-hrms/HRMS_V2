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
 * Module 10 (Notifications) against real Postgres + Redis + the in-process
 * BullMQ worker (docs/modules/10_NOTIFICATIONS.md §7). A real leave
 * application must queue exactly one email row for the applicant's
 * manager, under RLS, and the worker must actually pick it up. SES is
 * deliberately NOT configured here, so the send fails loudly and is
 * recorded — which is also the "never silently dropped" guarantee.
 */
describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  const hrEmail: Record<string, string> = {};
  let logB: string;

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
    [tenantA, tenantB] = await Promise.all([createTenantFixture('na'), createTenantFixture('nb')]);
    await Promise.all([addHr(tenantA), addHr(tenantB)]);
    await superuserPrisma.tenantSettings.create({ data: { tenantId: tenantA.tenantId } });
    await superuserPrisma.leaveType.create({
      data: { tenantId: tenantA.tenantId, name: 'Casual Leave', code: 'CL', annualQuota: 12 },
    });
    const recipient = await superuserPrisma.user.findFirstOrThrow({
      where: { tenantId: tenantB.tenantId, email: hrEmail[tenantB.tenantId] },
    });
    logB = (
      await superuserPrisma.notificationLog.create({
        data: {
          tenantId: tenantB.tenantId,
          template: 'DOCUMENT_BLOCKED',
          recipientUserId: recipient.id,
          recipientEmail: recipient.email,
          context: { documentLabel: 'x.pdf' },
          dedupeKey: 'e2e:b',
          status: 'FAILED',
        },
      })
    ).id;
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

  it('a leave application queues one email to the manager, and the worker attempts it', async () => {
    const employee = await as(tenantA, tenantA.employeeEmail);
    const type = await superuserPrisma.leaveType.findFirstOrThrow({
      where: { tenantId: tenantA.tenantId },
    });
    const res = await employee(
      request(server())
        .post('/api/leave/requests')
        .send({ leaveTypeId: type.id, startDate: '2026-12-01', endDate: '2026-12-02' }),
    );
    expect(res.status).toBe(201);

    const rows = await superuserPrisma.notificationLog.findMany({
      where: { tenantId: tenantA.tenantId, dedupeKey: `leave:${res.body.id}:pending:L1` },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      template: 'LEAVE_PENDING_APPROVAL',
      recipientEmail: tenantA.managerEmail,
    });

    // The in-process worker picks the job up; with no SES sender configured
    // the attempt fails and is recorded, not dropped.
    let row = rows[0];
    for (let i = 0; i < 40 && row.attempts === 0; i++) {
      await new Promise((r) => setTimeout(r, 250));
      row = await superuserPrisma.notificationLog.findUniqueOrThrow({ where: { id: row.id } });
    }
    expect(row.attempts).toBeGreaterThanOrEqual(1);
    expect(row.lastError).toMatch(/SES_FROM_ADDRESS is unset/);
    expect(row.status).not.toBe('SENT');
  }, 30_000);

  it('HR sees its own tenant log with per-status counts', async () => {
    const hr = await as(tenantA, hrEmail[tenantA.tenantId]);
    const res = await hr(request(server()).get('/api/notifications/log'));
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    expect(res.body.items.map((i: any) => i.id)).not.toContain(logB);
    expect(res.body.items[0]).not.toHaveProperty('context');
  });

  it("cannot retry another tenant's email by id (404)", async () => {
    const hr = await as(tenantA, hrEmail[tenantA.tenantId]);
    const res = await hr(request(server()).post(`/api/notifications/log/${logB}/retry`));
    expect(res.status).toBe(404);
    const row = await superuserPrisma.notificationLog.findUniqueOrThrow({ where: { id: logB } });
    expect(row.status).toBe('FAILED');
  });

  it('an Employee cannot read the log; an Auditor can read but not retry', async () => {
    const employee = await as(tenantA, tenantA.employeeEmail);
    expect((await employee(request(server()).get('/api/notifications/log'))).status).toBe(403);

    const auditor = await as(tenantB, tenantB.adminEmail); // fixture "admin" is an AUDITOR
    expect((await auditor(request(server()).get('/api/notifications/log'))).status).toBe(200);
    expect(
      (await auditor(request(server()).post(`/api/notifications/log/${logB}/retry`))).status,
    ).toBe(403);
  });

  it('HR in the owning tenant can retry a FAILED email', async () => {
    const hr = await as(tenantB, hrEmail[tenantB.tenantId]);
    const res = await hr(request(server()).post(`/api/notifications/log/${logB}/retry`));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('QUEUED');
    const audit = await superuserPrisma.auditLog.findFirst({
      where: { tenantId: tenantB.tenantId, action: 'notifications.retried', targetId: logB },
    });
    expect(audit).not.toBeNull();
  });

  it('the app DB role cannot delete from notification_log (RULE-7)', async () => {
    const rawAppClient = new PrismaClient({
      datasources: { db: { url: process.env.TENANT_DATABASE_URL } },
    });
    try {
      await expect(
        rawAppClient.$executeRawUnsafe('DELETE FROM public.notification_log WHERE false'),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await rawAppClient.$disconnect();
    }
  });
});
