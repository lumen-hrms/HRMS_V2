import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

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
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);

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

  const adminEmail = `admin@${subdomain}.test`;
  const managerEmail = `manager@${subdomain}.test`;
  const employeeEmail = `employee@${subdomain}.test`;

  // AUDITOR (not an MFA-required role) so the tenant-isolation suite can
  // exercise "full tenant visibility" assertions without also having to
  // drive the MFA enrollment flow — that's covered separately in
  // auth.e2e-spec.ts using an HR_MANAGER account.
  const adminUser = await superuserPrisma.user.create({
    data: { tenantId: tenant.id, email: adminEmail, passwordHash, role: 'AUDITOR' },
  });
  const managerUser = await superuserPrisma.user.create({
    data: { tenantId: tenant.id, email: managerEmail, passwordHash, role: 'LINE_MANAGER' },
  });
  const employeeUser = await superuserPrisma.user.create({
    data: { tenantId: tenant.id, email: employeeEmail, passwordHash, role: 'EMPLOYEE' },
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
  await superuserPrisma.auditLog.deleteMany({ where: { tenantId } });
  await superuserPrisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
}
