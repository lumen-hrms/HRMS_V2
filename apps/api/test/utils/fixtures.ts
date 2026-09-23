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

// --- Firebase (real project — no emulator) --------------------------------
//
// Tests run against the real Firebase project in FIREBASE_PROJECT_ID, using
// the Admin SDK (service-account creds) to create/manage users and the
// Identity Toolkit REST API (web API key) to sign one in for a real,
// verifiable ID token — the exact artifact `verifyIdToken` checks in prod.
// Every Firebase user a test creates is tracked and deleted in
// cleanupTenantFixture / afterAll so the project's user list stays clean.

const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;
if (!FIREBASE_WEB_API_KEY) {
  throw new Error('FIREBASE_WEB_API_KEY is not set — e2e tests sign in against real Firebase');
}

if (!admin.apps.length) {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID,
    credential: serviceAccountJson
      ? admin.credential.cert(JSON.parse(serviceAccountJson))
      : admin.credential.applicationDefault(),
  });
}
const firebaseAuth = admin.auth();

/** UIDs of every Firebase user created by the helpers below, for teardown. */
const createdUids = new Set<string>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retries a Firebase call through the throttling real Firebase applies to
 * bursts of auth operations (`QUOTA_EXCEEDED`, `TOO_MANY_ATTEMPTS_TRY_LATER`,
 * HTTP 429). Exponential backoff, ~5 attempts (~15s worst case). Anything
 * else rethrows immediately.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const msg = `${err?.code ?? ''} ${err?.message ?? ''}`;
      const throttled =
        err?.code === 'auth/too-many-requests' ||
        // TOO_MANY_ATTEMPTS/QUOTA_EXCEEDED/RESOURCE_EXHAUSTED are distinctive
        // enough to match loosely. `rate`/`429` are not — a bare `/rate/i`
        // used to false-positive on "geneRATE a new key file" in Firebase's
        // invalid-credential error text, which made a non-recoverable auth
        // failure look throttled and burn ~15s of retries before failing
        // anyway, so those two stay word-bounded.
        /TOO_MANY_ATTEMPTS|QUOTA_EXCEEDED|RESOURCE_EXHAUSTED|\brate.?limit(ed)?\b|\b429\b/i.test(
          msg,
        );
      if (!throttled) throw err;
      await sleep(500 * 2 ** attempt);
    }
  }
  throw new Error(`${label}: still throttled after retries — ${String(lastErr)}`);
}

/**
 * Creates a real Firebase user (Admin SDK) with the given custom claims. If
 * a prior crashed run left the email behind, it's replaced rather than
 * failing the run.
 */
export async function createFirebaseTestUser(
  email: string,
  claims: Record<string, unknown>,
  password = TEST_PASSWORD,
): Promise<string> {
  const uid = await withRetry(`createUser ${email}`, async () => {
    try {
      const created = await firebaseAuth.createUser({ email, password });
      return created.uid;
    } catch (err: any) {
      if (err?.code === 'auth/email-already-exists') {
        const existing = await firebaseAuth.getUserByEmail(email);
        await firebaseAuth.updateUser(existing.uid, { password, disabled: false });
        return existing.uid;
      }
      throw err;
    }
  });
  await withRetry(`setClaims ${email}`, () => firebaseAuth.setCustomUserClaims(uid, claims));
  createdUids.add(uid);
  return uid;
}

/**
 * Signs in against the Identity Toolkit REST endpoint to obtain a real ID
 * token — the Admin SDK can manage users but can't sign one in, so this is
 * the server-side equivalent of the Web SDK's `signInWithEmailAndPassword`.
 */
export async function getIdTokenForEmail(email: string, password = TEST_PASSWORD): Promise<string> {
  return withRetry(`signIn ${email}`, async () => {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_WEB_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    );
    const body = await res.json();
    if (!res.ok) {
      const code = body?.error?.message ?? `HTTP ${res.status}`;
      const err = new Error(`Firebase sign-in failed for ${email}: ${JSON.stringify(body)}`);
      (err as any).code = code;
      throw err;
    }
    return body.idToken as string;
  });
}

/** Best-effort delete of every Firebase user these helpers created. */
export async function deleteTrackedFirebaseUsers() {
  const uids = [...createdUids];
  createdUids.clear();
  for (let i = 0; i < uids.length; i += 1000) {
    await firebaseAuth.deleteUsers(uids.slice(i, i + 1000)).catch(() => undefined);
  }
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
      // `enabledModules` must cover every module the e2e suites exercise
      // (Leave, Attendance) — otherwise `EntitlementGuard` 403s before the
      // tenant-isolation checks these fixtures exist for ever run.
      subscription: {
        create: {
          plan: 'TRIAL',
          seats: 10,
          enabledModules: ['CORE_HR', 'LEAVE', 'ATTENDANCE'],
        },
      },
    },
  });

  const dept = await superuserPrisma.department.create({
    data: { tenantId: tenant.id, name: 'Engineering' },
  });

  const adminEmail = `admin+${subdomain}@example.test`;
  const managerEmail = `manager+${subdomain}@example.test`;
  const employeeEmail = `employee+${subdomain}@example.test`;

  // The shared fixture makes AUDITOR / LINE_MANAGER / EMPLOYEE so the
  // tenant-isolation suite can exercise "full tenant visibility" assertions.
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
  // Delete this tenant's Firebase users first (they're the only thing that
  // outlives a DB wipe — everything else is in Postgres).
  const users = await superuserPrisma.user.findMany({
    where: { tenantId },
    select: { firebaseUid: true },
  });
  const uids = users.map((u) => u.firebaseUid).filter(Boolean);
  if (uids.length) {
    await firebaseAuth.deleteUsers(uids).catch(() => undefined);
    uids.forEach((u) => createdUids.delete(u));
  }

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
  await superuserPrisma.loginAuditEntry.deleteMany({ where: { tenantId } });
  await superuserPrisma.user.deleteMany({ where: { tenantId } });
  await superuserPrisma.department.deleteMany({ where: { tenantId } });
  await superuserPrisma.shift.deleteMany({ where: { tenantId } });
  await superuserPrisma.holiday.deleteMany({ where: { tenantId } });
  await superuserPrisma.attendanceSettings.deleteMany({ where: { tenantId } });
  await superuserPrisma.tenantSettings.deleteMany({ where: { tenantId } });
  await superuserPrisma.auditLog.deleteMany({ where: { tenantId } });
  await superuserPrisma.notificationLog.deleteMany({ where: { tenantId } });
  await superuserPrisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
}
