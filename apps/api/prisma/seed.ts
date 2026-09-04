/**
 * Seeds 3 demo tenants with sample org data so there's something real to
 * click through immediately after `docker compose up` + migrate.
 *
 * Runs as the migration role (DATABASE_URL, i.e. hrms_superuser) which owns
 * every table and therefore bypasses RLS implicitly (RLS only restricts
 * non-owner roles unless FORCE ROW LEVEL SECURITY is set — which our
 * migration DID set, specifically so a seed/admin script run as the owner
 * still has to behave like a normal client). So this script sets
 * `app.current_tenant_id` itself before writing each tenant's rows, exactly
 * like the running API does, to prove the RLS policies work end-to-end
 * even for the owner role.
 *
 * User identity now lives in Firebase Auth, not this database — every
 * user/admin below is created via the Firebase Admin SDK (idempotently:
 * re-running the seed reuses the existing Firebase account by email) with
 * `tenantId`/`role` (or `type: 'platform_admin'`) set as custom claims,
 * and only the resulting `firebaseUid` is persisted here.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as admin from 'firebase-admin';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Passw0rd!123'; // dev-only, printed to console at the end

if (!admin.apps.length) {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID ?? 'hrms-platform-dev',
    credential: serviceAccountJson
      ? admin.credential.cert(JSON.parse(serviceAccountJson))
      : admin.credential.applicationDefault(),
  });
}
const firebaseAuth = admin.auth();

/** Creates the Firebase user if it doesn't exist yet, otherwise reuses it —
 * makes the seed script safe to re-run against the same emulator/project. */
async function upsertFirebaseUser(
  email: string,
  password: string,
  claims: Record<string, unknown>,
): Promise<string> {
  let uid: string;
  try {
    const existing = await firebaseAuth.getUserByEmail(email);
    uid = existing.uid;
  } catch {
    const created = await firebaseAuth.createUser({ email, password });
    uid = created.uid;
  }
  await firebaseAuth.setCustomUserClaims(uid, claims);
  return uid;
}

type Tx = Prisma.TransactionClient;

/**
 * Runs `fn` inside one interactive transaction, having first set the RLS
 * session variable on that same connection — the multi-statement analogue
 * of the single-operation `$extends` pattern used by TenantPrismaService at
 * request time. Every query inside `fn` MUST use the `tx` handle it's given
 * (not the top-level `prisma` client), or it runs on a different pooled
 * connection where the session variable was never set.
 */
async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, TRUE)`;
    return fn(tx);
  });
}

interface SeedEmployeeSpec {
  code: string;
  first: string;
  last: string;
  designation: string;
  dept: string;
  managerCode?: string;
  loginEmail: string;
  role: 'COMPANY_ADMIN' | 'HR_MANAGER' | 'LINE_MANAGER' | 'EMPLOYEE' | 'AUDITOR';
}

async function seedTenant(name: string, subdomain: string, employees: SeedEmployeeSpec[]) {
  const tenant = await prisma.tenant.upsert({
    where: { subdomain },
    update: {},
    create: {
      name,
      subdomain,
      status: 'ACTIVE',
      subscription: { create: { plan: 'GROWTH', seats: 200 } },
    },
  });

  // Resolve every Firebase account first — real network calls, kept outside
  // the DB transaction below so they can't run into its timeout.
  const firebaseUidByCode = new Map<string, string>();
  for (const spec of employees) {
    const firebaseUid = await upsertFirebaseUser(spec.loginEmail, DEMO_PASSWORD, {
      tenantId: tenant.id,
      role: spec.role,
    });
    firebaseUidByCode.set(spec.code, firebaseUid);
  }

  await withTenant(tenant.id, async (tx) => {
    const deptNames = [...new Set(employees.map((e) => e.dept))];
    const deptByName = new Map<string, string>();
    for (const dn of deptNames) {
      const dept = await tx.department.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name: dn } },
        update: {},
        create: { tenantId: tenant.id, name: dn },
      });
      deptByName.set(dn, dept.id);
    }

    const idByCode = new Map<string, string>();
    // Pass 1: create users + employees without manager links, using the
    // Firebase uid resolved up front (see below) — external network calls
    // must never happen inside this DB transaction, or a slow round-trip to
    // a real Firebase project (unlike the near-instant local emulator) can
    // outlast Prisma's interactive-transaction timeout.
    for (const spec of employees) {
      const firebaseUid = firebaseUidByCode.get(spec.code)!;
      const user = await tx.user.upsert({
        where: { tenantId_email: { tenantId: tenant.id, email: spec.loginEmail } },
        update: { firebaseUid },
        create: {
          tenantId: tenant.id,
          email: spec.loginEmail,
          firebaseUid,
          role: spec.role,
        },
      });
      const employee = await tx.employee.upsert({
        where: { tenantId_employeeCode: { tenantId: tenant.id, employeeCode: spec.code } },
        update: {},
        create: {
          tenantId: tenant.id,
          userId: user.id,
          employeeCode: spec.code,
          firstName: spec.first,
          lastName: spec.last,
          designation: spec.designation,
          departmentId: deptByName.get(spec.dept),
          dateOfJoining: new Date('2024-01-15'),
          employmentStatus: 'ACTIVE',
        },
      });
      idByCode.set(spec.code, employee.id);
    }

    // Pass 2: wire up reporting managers now that all ids exist.
    for (const spec of employees) {
      if (!spec.managerCode) continue;
      await tx.employee.update({
        where: { id: idByCode.get(spec.code)! },
        data: { reportingManagerId: idByCode.get(spec.managerCode) },
      });
    }

    // Leave types + this year's balances for everyone.
    const leaveTypeSpecs = [
      { name: 'Earned Leave', annualQuota: 18, carryForwardCap: 10 },
      { name: 'Sick Leave', annualQuota: 12, carryForwardCap: 0 },
      { name: 'Casual Leave', annualQuota: 8, carryForwardCap: 0 },
    ];
    const year = new Date().getFullYear();
    for (const lt of leaveTypeSpecs) {
      const leaveType = await tx.leaveType.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name: lt.name } },
        update: {},
        create: { tenantId: tenant.id, ...lt },
      });
      for (const employeeId of idByCode.values()) {
        await tx.leaveBalance.upsert({
          where: {
            tenantId_employeeId_leaveTypeId_year: {
              tenantId: tenant.id,
              employeeId,
              leaveTypeId: leaveType.id,
              year,
            },
          },
          update: {},
          create: {
            tenantId: tenant.id,
            employeeId,
            leaveTypeId: leaveType.id,
            year,
            accrued: lt.annualQuota,
            used: 0,
          },
        });
      }
    }

    // One sample pending leave request for the demo to have something in
    // the approvals queue immediately.
    const [firstEmployeeId] = [...idByCode.values()];
    const earnedLeave = await tx.leaveType.findFirstOrThrow({
      where: { tenantId: tenant.id, name: 'Earned Leave' },
    });
    const applicant = employees.find((e) => idByCode.get(e.code) === firstEmployeeId && e.managerCode);
    if (applicant) {
      const start = new Date();
      start.setDate(start.getDate() + 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 2);
      await tx.leaveRequest.create({
        data: {
          tenantId: tenant.id,
          employeeId: firstEmployeeId,
          leaveTypeId: earnedLeave.id,
          startDate: start,
          endDate: end,
          days: 3,
          reason: 'Family function',
          status: 'PENDING_L1',
        },
      });
    }
  });

  return tenant;
}

async function seedPlatformAdmin() {
  const email = 'founder@hrms-platform.dev';
  const firebaseUid = await upsertFirebaseUser(email, DEMO_PASSWORD, { type: 'platform_admin' });
  await prisma.platformAdminUser.upsert({
    where: { email },
    update: { firebaseUid },
    create: { email, firebaseUid, fullName: 'Platform Founder' },
  });
  return email;
}

async function main() {
  const founderEmail = await seedPlatformAdmin();

  const acme = await seedTenant('Acme Hospitals Pvt Ltd', 'acme', [
    { code: 'ACM-001', first: 'Asha', last: 'Rao', designation: 'CEO', dept: 'Executive', loginEmail: 'admin@acme.test', role: 'COMPANY_ADMIN' },
    { code: 'ACM-002', first: 'Vikram', last: 'Nair', designation: 'HR Head', dept: 'HR', managerCode: 'ACM-001', loginEmail: 'hr@acme.test', role: 'HR_MANAGER' },
    { code: 'ACM-003', first: 'Priya', last: 'Menon', designation: 'Nursing Manager', dept: 'Nursing', managerCode: 'ACM-001', loginEmail: 'manager@acme.test', role: 'LINE_MANAGER' },
    { code: 'ACM-004', first: 'Rahul', last: 'Verma', designation: 'Staff Nurse', dept: 'Nursing', managerCode: 'ACM-003', loginEmail: 'employee@acme.test', role: 'EMPLOYEE' },
    { code: 'ACM-005', first: 'Sneha', last: 'Iyer', designation: 'Staff Nurse', dept: 'Nursing', managerCode: 'ACM-003', loginEmail: 'employee2@acme.test', role: 'EMPLOYEE' },
    { code: 'ACM-006', first: 'Kiran', last: 'Das', designation: 'Statutory Auditor', dept: 'Finance', loginEmail: 'auditor@acme.test', role: 'AUDITOR' },
  ]);

  const beta = await seedTenant('Beta Textiles Ltd', 'beta', [
    { code: 'BET-001', first: 'Sunil', last: 'Gupta', designation: 'Managing Director', dept: 'Executive', loginEmail: 'admin@beta.test', role: 'COMPANY_ADMIN' },
    { code: 'BET-002', first: 'Meera', last: 'Pillai', designation: 'HR Manager', dept: 'HR', managerCode: 'BET-001', loginEmail: 'hr@beta.test', role: 'HR_MANAGER' },
    { code: 'BET-003', first: 'Arjun', last: 'Kumar', designation: 'Production Lead', dept: 'Production', managerCode: 'BET-001', loginEmail: 'manager@beta.test', role: 'LINE_MANAGER' },
    { code: 'BET-004', first: 'Divya', last: 'Shah', designation: 'Machine Operator', dept: 'Production', managerCode: 'BET-003', loginEmail: 'employee@beta.test', role: 'EMPLOYEE' },
  ]);

  const gamma = await seedTenant('Gamma Logistics', 'gamma', [
    { code: 'GAM-001', first: 'Anand', last: 'Krishnan', designation: 'Founder & CEO', dept: 'Executive', loginEmail: 'admin@gamma.test', role: 'COMPANY_ADMIN' },
    { code: 'GAM-002', first: 'Lakshmi', last: 'Narayan', designation: 'HR Business Partner', dept: 'HR', managerCode: 'GAM-001', loginEmail: 'hr@gamma.test', role: 'HR_MANAGER' },
    { code: 'GAM-003', first: 'Ravi', last: 'Teja', designation: 'Warehouse Supervisor', dept: 'Operations', managerCode: 'GAM-001', loginEmail: 'employee@gamma.test', role: 'EMPLOYEE' },
  ]);

  // eslint-disable-next-line no-console
  console.log(`
Seed complete. Every account below is a real Firebase Auth user
(FIREBASE_AUTH_EMULATOR_HOST must be set for local dev, or these land in
your real Firebase project).

Platform admin console:
  email:    ${founderEmail}
  password: ${DEMO_PASSWORD}

Tenants (send header  X-Tenant-Subdomain: <subdomain>  in dev mode):
  ${acme.name}  -> subdomain "acme"
  ${beta.name}  -> subdomain "beta"
  ${gamma.name} -> subdomain "gamma"

All seeded users share the password: ${DEMO_PASSWORD}
  admin@acme.test / hr@acme.test / manager@acme.test / employee@acme.test / employee2@acme.test / auditor@acme.test
  admin@beta.test / hr@beta.test / manager@beta.test / employee@beta.test
  admin@gamma.test / hr@gamma.test / employee@gamma.test
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
