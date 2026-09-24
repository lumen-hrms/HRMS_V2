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
 * Audit Log module (12) — the cross-module `/api/audit` aggregation feed.
 * Complements access.e2e-spec.ts's narrower `/api/access/audit` coverage:
 * this suite checks that events from *other* modules (employee-master,
 * attendance) land in the same append-only `audit_log` table and are
 * readable/filterable through the shared endpoint, with the same RBAC and
 * tenant-isolation guarantees.
 */
describe('Audit Log — cross-module aggregation (e2e)', () => {
  let app: INestApplication;
  let tenant: TenantFixture;
  let other: TenantFixture;

  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  async function addUser(role: string, key: string, t: TenantFixture = tenant) {
    const email = `${key}+${t.subdomain}@example.test`;
    const uid = await createFirebaseTestUser(email, { tenantId: t.tenantId, role });
    const user = await superuserPrisma.user.create({
      data: { tenantId: t.tenantId, email, firebaseUid: uid, role: role as any },
    });
    ids[`${key}@${t.subdomain}`] = user.id;
    tokens[`${key}@${t.subdomain}`] = await getIdTokenForEmail(email);
    return { email, uid, id: user.id };
  }

  const server = () => app.getHttpServer();
  const as = (key: string, t: TenantFixture, method: 'get' | 'post' | 'patch', path: string) =>
    (request(server())[method](path) as request.Test)
      .set('Authorization', `Bearer ${tokens[`${key}@${t.subdomain}`]}`)
      .set('X-Tenant-Subdomain', t.subdomain);

  let targetEmployeeId: string;

  beforeAll(async () => {
    app = await createTestApp();
    [tenant, other] = await Promise.all([
      createTenantFixture('audit'),
      createTenantFixture('audit-other'),
    ]);

    await addUser('COMPANY_ADMIN', 'ca');
    await addUser('HR_MANAGER', 'hr');
    await addUser('AUDITOR', 'aud');
    await addUser('EMPLOYEE', 'emp');
    await addUser('COMPANY_ADMIN', 'ca', other);

    // A dedicated target employee (not the fixture's built-in ones) so the
    // before/after compensation values in this suite's assertions never
    // collide with another test in the same file re-running.
    const dept = await superuserPrisma.department.findFirstOrThrow({
      where: { tenantId: tenant.tenantId },
    });
    const targetEmployee = await superuserPrisma.employee.create({
      data: {
        tenantId: tenant.tenantId,
        employeeCode: `${tenant.subdomain}-TARGET`,
        firstName: 'Target',
        lastName: 'Employee',
        departmentId: dept.id,
        designation: 'Engineer',
        ctcAnnual: 1000000,
      },
    });
    targetEmployeeId = targetEmployee.id;

    // employee-master event
    const updateRes = await as('hr', tenant, 'patch', `/api/employees/${targetEmployeeId}`).send({
      designation: 'Senior Engineer',
      ctcAnnual: 1400000,
    });
    expect(updateRes.status).toBe(200);

    // identity-access event
    const roleRes = await as(
      'ca',
      tenant,
      'patch',
      `/api/access/users/${ids[`emp@${tenant.subdomain}`]}/role`,
    ).send({
      newRole: 'LINE_MANAGER',
      reason: 'promoted for this suite',
    });
    expect(roleRes.status).toBe(200);

    // attendance event
    const markRes = await as('hr', tenant, 'post', '/api/attendance/mark').send({
      employeeId: targetEmployeeId,
      date: '2026-01-05',
      status: 'PRESENT',
      reason: 'Manual mark for audit e2e coverage',
    });
    expect(markRes.status).toBe(201);
  }, 60_000);

  afterAll(async () => {
    await cleanupTenantFixture(tenant.tenantId);
    await cleanupTenantFixture(other.tenantId);
    await deleteTrackedFirebaseUsers();
    await superuserPrisma.$disconnect();
    await app.close();
  });

  describe('GET /api/audit', () => {
    it('aggregates events from every module that writes audit_log', async () => {
      const res = await as('ca', tenant, 'get', '/api/audit');
      expect(res.status).toBe(200);
      const modules = new Set(res.body.map((r: any) => r.module));
      expect(modules.has('employee-master')).toBe(true);
      expect(modules.has('identity-access')).toBe(true);
      expect(modules.has('attendance')).toBe(true);
    });

    it('records the employee compensation before/after values', async () => {
      const res = await as('ca', tenant, 'get', '/api/audit?module=employee-master');
      expect(res.status).toBe(200);
      const row = res.body.find((r: any) => r.targetId === targetEmployeeId);
      expect(row).toBeDefined();
      expect(row.action).toBe('employee.updated');
      expect(row.metadata.changes).toEqual(
        expect.arrayContaining([
          { field: 'designation', before: 'Engineer', after: 'Senior Engineer' },
          { field: 'ctcAnnual', before: 1000000, after: 1400000 },
        ]),
      );
    });

    it('filters by module', async () => {
      const res = await as('ca', tenant, 'get', '/api/audit?module=attendance');
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body.every((r: any) => r.module === 'attendance')).toBe(true);
    });

    it('allows an Auditor (read-only role) the same access as Company Admin', async () => {
      const res = await as('aud', tenant, 'get', '/api/audit');
      expect(res.status).toBe(200);
    });

    it('forbids an Employee', async () => {
      const res = await as('emp', tenant, 'get', '/api/audit');
      expect(res.status).toBe(403);
    });

    it('never leaks another tenant’s audit rows', async () => {
      const res = await as('ca', other, 'get', '/api/audit');
      expect(res.status).toBe(200);
      expect(res.body.some((r: any) => r.targetId === targetEmployeeId)).toBe(false);
    });
  });

  describe('GET /api/audit/modules', () => {
    it('lists the distinct modules seen for this tenant', async () => {
      const res = await as('ca', tenant, 'get', '/api/audit/modules');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.arrayContaining(['employee-master', 'identity-access', 'attendance']),
      );
    });
  });
});
