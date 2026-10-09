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
 * Payroll (module 07) adversarial tenant-isolation + authorization suite —
 * CLAUDE.md calls this class of test non-negotiable: "log in as tenant A,
 * assert every attempt to read/write tenant B's data fails".
 *
 * Tenant B owns a real PayrollRun (PROCESSED) with a line item, a salary
 * structure, a settings row, PT slabs, an F&F settlement and a TDS regime
 * choice. Every route in PayrollController that takes a tenant-owned id is
 * attacked from tenant A with a valid, correctly-scoped session, and after
 * each mutating attempt we re-read B's rows as the superuser to prove nothing
 * moved. The last block checks the guarantees at the Postgres layer itself
 * (RLS fail-closed, platform role grants, the INV-2 immutability trigger).
 */
describe('Payroll isolation & authorization (e2e)', () => {
  let app: INestApplication;
  let a: TenantFixture;
  let b: TenantFixture;

  const tokens: Record<string, string> = {};
  let bRunId: string;
  let bApprovedRunId: string;

  const server = () => app.getHttpServer();
  const asA = (
    who: 'hr' | 'ca' | 'aud' | 'emp' | 'mgr',
    method: 'get' | 'post' | 'patch' | 'put',
    path: string,
  ) =>
    (request(server())[method](`/api/payroll${path}`) as request.Test)
      .set('Authorization', `Bearer ${tokens[who]}`)
      .set('X-Tenant-Subdomain', a.subdomain);

  async function addLogin(t: TenantFixture, role: string, key: string) {
    const email = `${key}+${t.subdomain}@example.test`;
    const uid = await createFirebaseTestUser(email, { tenantId: t.tenantId, role });
    await superuserPrisma.user.create({
      data: { tenantId: t.tenantId, email, firebaseUid: uid, role: role as any },
    });
    return email;
  }

  beforeAll(async () => {
    app = await createTestApp();
    [a, b] = await Promise.all([createTenantFixture('pay-a'), createTenantFixture('pay-b')]);
    for (const t of [a, b]) {
      await superuserPrisma.subscription.updateMany({
        where: { tenantId: t.tenantId },
        data: { enabledModules: ['CORE_HR', 'LEAVE', 'ATTENDANCE', 'PAYROLL'] },
      });
    }

    const hrEmail = await addLogin(a, 'HR_MANAGER', 'hr');
    const caEmail = await addLogin(a, 'COMPANY_ADMIN', 'ca');
    tokens.hr = await getIdTokenForEmail(hrEmail);
    tokens.ca = await getIdTokenForEmail(caEmail);
    tokens.aud = await getIdTokenForEmail(a.adminEmail); // fixture admin is an AUDITOR
    tokens.mgr = await getIdTokenForEmail(a.managerEmail);
    tokens.emp = await getIdTokenForEmail(a.employeeEmail);

    // ---- Tenant B's payroll data (arranged as the superuser) ----
    const run = await superuserPrisma.payrollRun.create({
      data: {
        tenantId: b.tenantId,
        period: '2026-08',
        status: 'PROCESSED',
        preparedBy: b.adminEmployeeId,
        processedAt: new Date(),
      },
    });
    bRunId = run.id;
    await superuserPrisma.payrollLineItem.create({
      data: {
        tenantId: b.tenantId,
        runId: run.id,
        employeeId: b.employeeEmployeeId,
        workingDays: 26,
        payableDays: 26,
        lopDays: 0,
        grossEarnings: '50000.00',
        epfEmployee: '1800.00',
        epfEmployer: '1800.00',
        esiEmployee: '0',
        esiEmployer: '0',
        professionalTax: '200.00',
        netPay: '48000.00',
      },
    });
    const approved = await superuserPrisma.payrollRun.create({
      data: {
        tenantId: b.tenantId,
        period: '2026-09',
        status: 'APPROVED',
        preparedBy: b.adminEmployeeId,
      },
    });
    bApprovedRunId = approved.id;

    await superuserPrisma.salaryStructure.create({
      data: {
        tenantId: b.tenantId,
        employeeId: b.employeeEmployeeId,
        ctcAnnual: '600000.00',
        effectiveFrom: new Date('2026-04-01'),
      },
    });
    await superuserPrisma.payrollSettings.create({
      data: { tenantId: b.tenantId, epfCeiling: '99999' },
    });
    await superuserPrisma.professionalTaxSlab.create({
      data: {
        tenantId: b.tenantId,
        state: 'KARNATAKA',
        grossFrom: '0',
        monthlyAmount: '777.00',
      },
    });
    await superuserPrisma.tdsRegimeChoice.create({
      data: {
        tenantId: b.tenantId,
        employeeId: b.employeeEmployeeId,
        financialYear: '2026-27',
        regime: 'OLD',
      },
    });
    await superuserPrisma.employee.update({
      where: { id: b.employeeEmployeeId },
      data: { lifecycleState: 'SEPARATED', lastWorkingDate: new Date('2026-08-31') },
    });
    await superuserPrisma.fullAndFinalSettlement.create({
      data: {
        tenantId: b.tenantId,
        employeeId: b.employeeEmployeeId,
        separationDate: new Date('2026-08-31'),
        unpaidSalaryDays: 5,
        unpaidSalaryAmount: '1000',
        leaveEncashmentDays: '0',
        leaveEncashmentAmount: '0',
        gratuityYearsOfService: 0,
        gratuityAmount: '0',
        netSettlement: '1000',
        preparedBy: b.adminEmployeeId,
      },
    });
  }, 120_000);

  afterAll(async () => {
    for (const t of [a, b]) {
      const where = { tenantId: t.tenantId };
      // Payroll rows first: line items / structures hold RESTRICT FKs to employees.
      await superuserPrisma.$executeRawUnsafe(
        `ALTER TABLE public.payroll_line_items DISABLE TRIGGER payroll_line_items_immutable`,
      );
      await superuserPrisma.payrollLineItem.deleteMany({ where });
      await superuserPrisma.$executeRawUnsafe(
        `ALTER TABLE public.payroll_line_items ENABLE TRIGGER payroll_line_items_immutable`,
      );
      await superuserPrisma.payrollRun.deleteMany({ where });
      await superuserPrisma.fullAndFinalSettlement.deleteMany({ where });
      await superuserPrisma.arrearsLineItem.deleteMany({ where });
      await superuserPrisma.salaryRevision.deleteMany({ where });
      await superuserPrisma.salaryStructure.deleteMany({ where });
      await superuserPrisma.tdsRegimeChoice.deleteMany({ where });
      await superuserPrisma.overtimeClaim.deleteMany({ where });
      await superuserPrisma.professionalTaxSlab.deleteMany({ where });
      await superuserPrisma.payrollSettings.deleteMany({ where });
      await superuserPrisma.taxSlab.deleteMany({ where });
      await superuserPrisma.taxRegimeConfig.deleteMany({ where });
      await cleanupTenantFixture(t.tenantId);
    }
    await deleteTrackedFirebaseUsers();
    await superuserPrisma.$disconnect();
    await app.close();
  }, 120_000);

  const notOk = (status: number) => expect([400, 403, 404, 409]).toContain(status);

  // ---- Reads: tenant B ids from a tenant A session ----

  describe('reads of tenant B data from a tenant A session', () => {
    it('GET /runs/:id of B’s run is invisible to A', async () => {
      const own = await asA('hr', 'get', `/runs/${bRunId}`);
      expect(own.status).toBe(404);
    });

    it('bank file of B’s run is invisible to A', async () => {
      const res = await asA('hr', 'get', `/runs/${bRunId}/bank-file?format=CSV`);
      notOk(res.status);
    });

    it('B’s salary structure is invisible to A’s HR', async () => {
      notOk((await asA('hr', 'get', `/structures/${b.employeeEmployeeId}`)).status);
    });

    it('B’s payslip is not downloadable by A’s HR or by A’s employee', async () => {
      notOk((await asA('hr', 'get', `/payslips/${b.employeeEmployeeId}?period=2026-08`)).status);
      notOk((await asA('emp', 'get', `/payslips/${b.employeeEmployeeId}?period=2026-08`)).status);
    });

    it('B’s TDS regime choice and F&F settlement are invisible to A', async () => {
      notOk((await asA('hr', 'get', `/tds-regime/${b.employeeEmployeeId}`)).status);
      notOk((await asA('hr', 'get', `/fnf/${b.employeeEmployeeId}`)).status);
    });

    it('config reads return only A’s own values, never B’s', async () => {
      const settings = await asA('hr', 'get', '/config/settings');
      expect(settings.status).toBe(200);
      expect(JSON.stringify(settings.body)).not.toContain('99999');

      const pt = await asA('hr', 'get', '/config/pt-slabs');
      expect(pt.status).toBe(200);
      expect(JSON.stringify(pt.body)).not.toContain('777');
    });
  });

  // ---- Writes: nothing in B may move ----

  describe('writes aimed at tenant B from a tenant A session', () => {
    it.each(['recalculate', 'submit-review', 'approve', 'process', 'disburse'])(
      'POST /runs/:id/%s on B’s run is rejected and B’s run is untouched',
      async (action) => {
        const res = await asA('hr', 'post', `/runs/${bApprovedRunId}/${action}`);
        notOk(res.status);
        const after = await superuserPrisma.payrollRun.findUnique({
          where: { id: bApprovedRunId },
          include: { approvals: true },
        });
        expect(after?.status).toBe('APPROVED');
        expect(after?.approvals).toHaveLength(0);
        expect(after?.processedAt).toBeNull();
      },
    );

    it('PATCH line-item adjustments on B’s run are rejected', async () => {
      const res = await asA(
        'hr',
        'patch',
        `/runs/${bRunId}/line-items/${b.employeeEmployeeId}`,
      ).send({ adjustments: [{ type: 'BONUS', amount: 1000 }] });
      notOk(res.status);
      const item = await superuserPrisma.payrollLineItem.findFirst({ where: { runId: bRunId } });
      expect(item?.adHocAdjustments).toEqual([]);
      expect(item?.netPay.toString()).toBe('48000');
    });

    it('creating a salary structure for B’s employee creates nothing', async () => {
      const before = await superuserPrisma.salaryStructure.count({
        where: { employeeId: b.employeeEmployeeId },
      });
      const res = await asA('hr', 'post', `/structures/${b.employeeEmployeeId}`).send({
        ctcAnnual: 999999,
        effectiveFrom: '2026-04-01',
        components: [
          { type: 'BASIC', name: 'Basic', calculationMode: 'PERCENT_OF_CTC', value: 50 },
        ],
      });
      notOk(res.status);
      expect(
        await superuserPrisma.salaryStructure.count({
          where: { employeeId: b.employeeEmployeeId },
        }),
      ).toBe(before);
    });

    it('revising B’s employee structure is rejected', async () => {
      const res = await asA('hr', 'post', `/structures/${b.employeeEmployeeId}/revise`).send({
        ctcAnnual: 1,
        effectiveDate: '2026-04-01',
        reason: 'attack attempt on another tenant',
        components: [
          { type: 'BASIC', name: 'Basic', calculationMode: 'PERCENT_OF_CTC', value: 50 },
        ],
      });
      notOk(res.status);
      expect(await superuserPrisma.salaryRevision.count({ where: { tenantId: b.tenantId } })).toBe(
        0,
      );
    });

    it('setting B’s employee TDS regime is rejected and B’s choice stays OLD', async () => {
      const res = await asA('hr', 'put', `/tds-regime/${b.employeeEmployeeId}`).send({
        financialYear: '2026-27',
        regime: 'NEW',
      });
      notOk(res.status);
      const choice = await superuserPrisma.tdsRegimeChoice.findFirst({
        where: { employeeId: b.employeeEmployeeId },
      });
      expect(choice?.regime).toBe('OLD');
    });

    it.each(['approve', 'mark-paid'])('F&F %s on B’s employee is rejected', async (action) => {
      notOk((await asA('hr', 'post', `/fnf/${b.employeeEmployeeId}/${action}`)).status);
      const row = await superuserPrisma.fullAndFinalSettlement.findUnique({
        where: { employeeId: b.employeeEmployeeId },
      });
      expect(row?.status).toBe('DRAFT');
      expect(row?.approvedBy).toBeNull();
    });

    it('A editing its own settings / PT slabs / tax slabs never touches B', async () => {
      const s = await asA('ca', 'patch', '/config/settings').send({ epfCeiling: 12345 });
      expect(s.status).toBe(200);
      const pt = await asA('ca', 'put', '/config/pt-slabs/KARNATAKA').send({
        slabs: [{ grossFrom: 0, monthlyAmount: 1 }],
      });
      expect([200, 201]).toContain(pt.status);

      const bSettings = await superuserPrisma.payrollSettings.findUnique({
        where: { tenantId: b.tenantId },
      });
      expect(bSettings?.epfCeiling.toString()).toBe('99999');
      const bSlabs = await superuserPrisma.professionalTaxSlab.findMany({
        where: { tenantId: b.tenantId },
      });
      expect(bSlabs).toHaveLength(1);
      expect(bSlabs[0].monthlyAmount.toString()).toBe('777');
    });
  });

  // ---- Session / header attacks ----

  describe('session attacks', () => {
    it('A’s token replayed against B’s subdomain is refused on every payroll surface', async () => {
      for (const path of [
        '/config/settings',
        `/runs/${bRunId}`,
        `/structures/${b.employeeEmployeeId}`,
      ]) {
        const res = await request(server())
          .get(`/api/payroll${path}`)
          .set('Authorization', `Bearer ${tokens.hr}`)
          .set('X-Tenant-Subdomain', b.subdomain);
        expect(res.status).toBe(403);
      }
    });

    it('an unauthenticated caller gets 401', async () => {
      const res = await request(server())
        .get('/api/payroll/config/settings')
        .set('X-Tenant-Subdomain', a.subdomain);
      expect(res.status).toBe(401);
    });

    it('a body/query tenantId is never trusted', async () => {
      const res = await asA('hr', 'get', `/config/settings?tenantId=${b.tenantId}`);
      expect(JSON.stringify(res.body)).not.toContain('99999');
    });
  });

  // ---- Role matrix inside one tenant ----

  describe('role gates and own-data scoping inside tenant A', () => {
    it.each(['emp', 'mgr'] as const)('%s cannot create a payroll run', async (who) => {
      expect((await asA(who, 'post', '/runs').send({ period: '2026-10' })).status).toBe(403);
    });

    it.each(['emp', 'mgr'] as const)('%s cannot read payroll settings', async (who) => {
      expect((await asA(who, 'get', '/config/settings')).status).toBe(403);
    });

    it('an Auditor can read config but cannot write it or run payroll', async () => {
      expect((await asA('aud', 'get', '/config/settings')).status).toBe(200);
      expect((await asA('aud', 'patch', '/config/settings').send({ epfCeiling: 1 })).status).toBe(
        403,
      );
      expect((await asA('aud', 'post', '/runs').send({ period: '2026-10' })).status).toBe(403);
    });

    it('an Employee cannot read a colleague’s payslip or TDS regime in the same tenant', async () => {
      notOk((await asA('emp', 'get', `/payslips/${a.managerEmployeeId}?period=2026-08`)).status);
      notOk((await asA('emp', 'get', `/tds-regime/${a.managerEmployeeId}`)).status);
      notOk(
        (
          await asA('emp', 'put', `/tds-regime/${a.managerEmployeeId}`).send({
            financialYear: '2026-27',
            regime: 'OLD',
          })
        ).status,
      );
    });

    it('an Employee cannot see a salary structure', async () => {
      notOk((await asA('emp', 'get', `/structures/${a.managerEmployeeId}`)).status);
    });

    it('rejects malformed ids instead of leaking a 500', async () => {
      expect((await asA('hr', 'get', '/runs/not-a-uuid')).status).toBe(400);
    });
  });

  // ---- Postgres-level guarantees ----

  describe('database-level guarantees', () => {
    const payrollTables = [
      'salary_structures',
      'salary_components',
      'salary_revisions',
      'arrears_line_items',
      'payroll_settings',
      'professional_tax_slabs',
      'payroll_runs',
      'payroll_run_approvals',
      'payroll_line_items',
      'tax_slabs',
      'tax_regime_configs',
      'tds_regime_choices',
      'full_and_final_settlements',
      'overtime_claims',
    ];

    it('hrms_app with no tenant context sees zero rows in every payroll table (RLS fails closed)', async () => {
      const raw = new PrismaClient({
        datasources: { db: { url: process.env.TENANT_DATABASE_URL } },
      });
      try {
        for (const t of payrollTables) {
          const rows = await raw.$queryRawUnsafe<Array<{ n: bigint }>>(
            `SELECT count(*)::bigint AS n FROM public.${t}`,
          );
          expect(Number(rows[0].n)).toBe(0);
        }
      } finally {
        await raw.$disconnect();
      }
    });

    it('with tenant A’s context hrms_app cannot see or modify any of B’s payroll rows', async () => {
      const raw = new PrismaClient({
        datasources: { db: { url: process.env.TENANT_DATABASE_URL } },
      });
      try {
        await raw.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `SELECT set_config('app.current_tenant_id', '${a.tenantId}', true)`,
          );
          for (const t of payrollTables) {
            const rows = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(
              `SELECT count(*)::bigint AS n FROM public.${t} WHERE tenant_id = '${b.tenantId}'`,
            );
            expect(Number(rows[0].n)).toBe(0);
          }
          const updated = await tx.$executeRawUnsafe(
            `UPDATE public.payroll_runs SET status = 'DISBURSED' WHERE id = '${bApprovedRunId}'`,
          );
          expect(updated).toBe(0);
          const deleted = await tx.$executeRawUnsafe(
            `DELETE FROM public.payroll_settings WHERE tenant_id = '${b.tenantId}'`,
          );
          expect(deleted).toBe(0);
        });
      } finally {
        await raw.$disconnect();
      }
    });

    it('cannot insert a payroll row for another tenant (RLS WITH CHECK)', async () => {
      const raw = new PrismaClient({
        datasources: { db: { url: process.env.TENANT_DATABASE_URL } },
      });
      try {
        await expect(
          raw.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(
              `SELECT set_config('app.current_tenant_id', '${a.tenantId}', true)`,
            );
            await tx.$executeRawUnsafe(
              `INSERT INTO public.payroll_settings (id, tenant_id, updated_at) VALUES (gen_random_uuid(), '${b.tenantId}', now())`,
            );
          }),
        ).rejects.toThrow();
      } finally {
        await raw.$disconnect();
      }
    });

    it('the platform DB role has no access to any payroll table', async () => {
      const raw = new PrismaClient({
        datasources: { db: { url: process.env.PLATFORM_DATABASE_URL } },
      });
      try {
        for (const t of payrollTables) {
          await expect(raw.$queryRawUnsafe(`SELECT 1 FROM public.${t} LIMIT 1`)).rejects.toThrow(
            /permission denied/i,
          );
        }
      } finally {
        await raw.$disconnect();
      }
    });

    it('INV-2: a line item of a PROCESSED run cannot be updated or deleted, even by the superuser', async () => {
      await expect(
        superuserPrisma.payrollLineItem.updateMany({
          where: { runId: bRunId },
          data: { netPay: '1.00' },
        }),
      ).rejects.toThrow(/INV-2/);
      await expect(
        superuserPrisma.payrollLineItem.deleteMany({ where: { runId: bRunId } }),
      ).rejects.toThrow(/INV-2/);
      const item = await superuserPrisma.payrollLineItem.findFirst({ where: { runId: bRunId } });
      expect(item?.netPay.toString()).toBe('48000');
    });
  });
});
