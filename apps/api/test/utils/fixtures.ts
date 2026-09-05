import { PrismaClient } from '@prisma/client';
import * as admin from 'firebase-admin';

/**
 * Connects as the migration/superuser role (DATABASE_URL) which owns every
 * table and has BYPASSRLS, so fixture setup doesn't need to go through the
 * RLS dance the app itself uses. This is only ever used to ARRANGE test
 * data — every assertion in the actual test files goes through either the
 * real HTTP API (which uses the low-privilege hrms_app/hrms_platform roles)
 * or a raw connection opened with those same low-privilege roles.
 */
export const superuserPrisma = new PrismaClient();

export const TEST_PASSWORD = 'Test-Passw0rd!1';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'hrms-platform-dev' });
}
const firebaseAuth = admin.auth();

/**
 * Creates a real Firebase user against the Auth Emulator (FIREBASE_AUTH_
 * EMULATOR_HOST must be set — see test/jest-e2e setup) with the given
 * custom claims, so tests exercise the exact same `verifyIdToken` path
 * production traffic does — no bcrypt/JWT test doubles.
 */
export async function createFirebaseTestUser(
  email: string,
  claims: Record<string, unknown>,
  password = TEST_PASSWORD,
): Promise<string> {
  const created = await firebaseAuth.createUser({ email, password });
  await firebaseAuth.setCustomUserClaims(created.uid, claims);
  return created.uid;
}

/**
 * Signs in against the Auth Emulator's REST endpoint to obtain a real,
 * verifiable ID token — the Admin SDK can create/manage users but can't
 * sign one in itself, so this is the emulator equivalent of what the
 * Firebase Web SDK's `signInWithEmailAndPassword` does in the browser.
 */
export async function getIdTokenForEmail(email: string, password = TEST_PASSWORD): Promise<string> {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!host) throw new Error('FIREBASE_AUTH_EMULATOR_HOST is not set — tests require the emulator');

  const res = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Emulator sign-in failed for ${email}: ${JSON.stringify(body)}`);
  }
  return body.idToken as string;
}

export interface TenantFixture {
  tenantId: string;
  subdomain: string;
  adminEmail: string;
  employeeEmail: string;
  managerEmail: string;
  adminEmployeeId: string;
  managerEmployeeId: string;
  employeeEmployeeId: string;
}

let counter = 0;

export async function createTenantFixture(label: string): Promise<TenantFixture> {
  counter += 1;
  const subdomain = `e2e-${label}-${Date.now()}-${counter}`;

  const tenant = await superuserPrisma.tenant.create({
    data: {
      name: `E2E ${label}`,
      subdomain,
      status: 'ACTIVE',
      subscription: { create: { plan: 'TRIAL', seats: 10 } },
    },
  });

  const dept = await superuserPrisma.department.create({
    data: { tenantId: tenant.id, name: 'Engineering' },
  });

  const adminEmail = `admin+${subdomain}@example.test`;
  const managerEmail = `manager+${subdomain}@example.test`;
  const employeeEmail = `employee+${subdomain}@example.test`;

  // AUDITOR/LINE_MANAGER/EMPLOYEE (none are MFA-relevant now that MFA is
  // gone entirely) so the tenant-isolation suite can exercise "full tenant
  // visibility" assertions with plain Firebase-emulator accounts.
  const adminUid = await createFirebaseTestUser(adminEmail, {
    tenantId: tenant.id,
    role: 'AUDITOR',
  });
  const managerUid = await createFirebaseTestUser(managerEmail, {
    tenantId: tenant.id,
    role: 'LINE_MANAGER',
  });
  const employeeUid = await createFirebaseTestUser(employeeEmail, {
    tenantId: tenant.id,
    role: 'EMPLOYEE',
  });

  const adminUser = await superuserPrisma.user.create({
    data: { tenantId: tenant.id, email: adminEmail, firebaseUid: adminUid, role: 'AUDITOR' },
  });
  const managerUser = await superuserPrisma.user.create({
    data: {
      tenantId: tenant.id,
      email: managerEmail,
      firebaseUid: managerUid,
      role: 'LINE_MANAGER',
    },
  });
  const employeeUser = await superuserPrisma.user.create({
    data: { tenantId: tenant.id, email: employeeEmail, firebaseUid: employeeUid, role: 'EMPLOYEE' },
  });

  const adminEmployee = await superuserPrisma.employee.create({
    data: {
      tenantId: tenant.id,
      userId: adminUser.id,
      employeeCode: `${subdomain}-ADMIN`,
      firstName: 'Admin',
      lastName: label,
      departmentId: dept.id,
    },
  });
  const managerEmployee = await superuserPrisma.employee.create({
    data: {
      tenantId: tenant.id,
      userId: managerUser.id,
      employeeCode: `${subdomain}-MGR`,
      firstName: 'Manager',
      lastName: label,
      departmentId: dept.id,
      reportingManagerId: adminEmployee.id,
    },
  });
  const employeeEmployee = await superuserPrisma.employee.create({
    data: {
      tenantId: tenant.id,
      userId: employeeUser.id,
      employeeCode: `${subdomain}-EMP`,
      firstName: 'Worker',
      lastName: label,
      departmentId: dept.id,
      reportingManagerId: managerEmployee.id,
    },
  });

  return {
    tenantId: tenant.id,
    subdomain,
    adminEmail,
    managerEmail,
    employeeEmail,
    adminEmployeeId: adminEmployee.id,
    managerEmployeeId: managerEmployee.id,
    employeeEmployeeId: employeeEmployee.id,
  };
}

export async function cleanupTenantFixture(tenantId: string) {
  // There is deliberately no real foreign key from platform.tenants into
  // any `public` table (the two schemas are fully decoupled), so deleting
  // the tenant row does NOT cascade into tenant business data — clean up
  // both sides explicitly.
  await superuserPrisma.punch.deleteMany({ where: { tenantId } });
  await superuserPrisma.regularizationRequest.deleteMany({ where: { tenantId } });
  await superuserPrisma.attendanceBreak.deleteMany({ where: { tenantId } });
  await superuserPrisma.attendanceRecord.deleteMany({ where: { tenantId } });
  await superuserPrisma.leaveRequest.deleteMany({ where: { tenantId } });
  await superuserPrisma.leaveBalance.deleteMany({ where: { tenantId } });
  await superuserPrisma.leaveType.deleteMany({ where: { tenantId } });
  await superuserPrisma.document.deleteMany({ where: { tenantId } });
  await superuserPrisma.employee.updateMany({
    where: { tenantId },
    data: { reportingManagerId: null },
  });
  await superuserPrisma.employee.deleteMany({ where: { tenantId } });
  await superuserPrisma.user.deleteMany({ where: { tenantId } });
  await superuserPrisma.department.deleteMany({ where: { tenantId } });
  await superuserPrisma.shift.deleteMany({ where: { tenantId } });
  await superuserPrisma.holiday.deleteMany({ where: { tenantId } });
  await superuserPrisma.attendanceSettings.deleteMany({ where: { tenantId } });
  await superuserPrisma.tenantSettings.deleteMany({ where: { tenantId } });
  await superuserPrisma.auditLog.deleteMany({ where: { tenantId } });
  await superuserPrisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
}
