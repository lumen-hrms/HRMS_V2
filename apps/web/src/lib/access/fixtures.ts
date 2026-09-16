/**
 * In-memory mock dataset for the Identity & Access module.
 *
 * Why this exists: the access-management screens (Users, role/status changes,
 * password-reset, the login + access-change audit trail) have no backend yet —
 * `docs/modules/01_IDENTITY_AND_ACCESS.md` §9 gaps 1 + 3. Building the UI
 * against this fixture store means every screen renders and every interaction
 * round-trips, so the screens are reviewable now and the mock doubles as the
 * API contract for `GET /api/access/users`, `PATCH .../role`, `PATCH .../status`,
 * `POST .../password-reset`, and `GET /api/access/audit`.
 *
 * The store is mutable at runtime (client.ts mutates it on role/status change)
 * so the UI behaves like the real thing within a session. A reload resets it.
 */
import type { Role } from '@/lib/roles';
import type { AccessUser, AccessAuditEntry, LoginAuditEntry } from './types';

/** Stand-in tenant for the mock — the real tenant name comes from the subdomain. */
export const MOCK_TENANT_NAME = 'Acme Corp';

function daysAgo(n: number, hour = 10, min = 15): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, min, 0, 0);
  return d.toISOString();
}

interface Seed {
  id: string;
  first: string;
  last: string;
  code: string;
  designation: string;
  department: string;
  role: Role;
  isActive: boolean;
  lastLoginDays: number | null;
  device: string | null;
  ip: string | null;
  /** rare: a login with no linked employee record (bootstrap admin) */
  noEmployee?: boolean;
}

const SEEDS: Seed[] = [
  { id: 'u-01', first: 'Vikram', last: 'Sen', code: 'ACM-0001', designation: 'Founder & CEO', department: 'Leadership', role: 'COMPANY_ADMIN', isActive: true, lastLoginDays: 0, device: 'Edge on Windows', ip: '103.21.14.8' },
  { id: 'u-02', first: 'Rajesh', last: 'Nair', code: 'ACM-0014', designation: 'Head of IT', department: 'Information Technology', role: 'COMPANY_ADMIN', isActive: true, lastLoginDays: 1, device: 'Chrome on Windows', ip: '103.21.14.22' },
  { id: 'u-03', first: 'Eleanor', last: 'Vance', code: 'ACM-0012', designation: 'Senior People Partner', department: 'People Operations', role: 'HR_MANAGER', isActive: true, lastLoginDays: 0, device: 'Chrome on macOS', ip: '49.36.220.11' },
  { id: 'u-04', first: 'Meera', last: 'Iyer', code: 'ACM-0031', designation: 'HR Manager', department: 'People Operations', role: 'HR_MANAGER', isActive: true, lastLoginDays: 2, device: 'Firefox on Ubuntu', ip: '49.36.220.40' },
  { id: 'u-05', first: 'Priya', last: 'Venkataraman', code: 'ACM-1088', designation: 'Engineering Manager', department: 'Engineering', role: 'LINE_MANAGER', isActive: true, lastLoginDays: 1, device: 'Safari on iOS', ip: '106.51.10.4' },
  { id: 'u-06', first: 'Rohan', last: 'Mehta', code: 'ACM-0044', designation: 'Sales Lead', department: 'Sales', role: 'LINE_MANAGER', isActive: true, lastLoginDays: 3, device: 'Chrome on Windows', ip: '103.21.14.51' },
  { id: 'u-07', first: 'Karthik', last: 'Reddy', code: 'ACM-0501', designation: 'Support Lead', department: 'Customer Success', role: 'LINE_MANAGER', isActive: false, lastLoginDays: 34, device: 'Chrome on Android', ip: '157.32.14.9' },
  { id: 'u-08', first: 'Aarav', last: 'Sharma', code: 'ACM-1042', designation: 'Senior Software Engineer', department: 'Engineering', role: 'EMPLOYEE', isActive: true, lastLoginDays: 0, device: 'Firefox on Ubuntu', ip: '49.36.220.77' },
  { id: 'u-09', first: 'Ananya', last: 'Gupta', code: 'ACM-1077', designation: 'Product Designer', department: 'Design', role: 'EMPLOYEE', isActive: true, lastLoginDays: 4, device: 'Chrome on macOS', ip: '106.51.10.88' },
  { id: 'u-10', first: 'Ishaan', last: 'Patel', code: 'ACM-1109', designation: 'Account Executive', department: 'Sales', role: 'EMPLOYEE', isActive: true, lastLoginDays: 7, device: 'Safari on macOS', ip: '103.21.14.90' },
  { id: 'u-11', first: 'Diya', last: 'Krishnan', code: 'ACM-1120', designation: 'Financial Analyst', department: 'Finance', role: 'EMPLOYEE', isActive: true, lastLoginDays: null, device: null, ip: null },
  { id: 'u-12', first: 'Aditya', last: 'Joshi', code: 'ACM-1131', designation: 'QA Engineer', department: 'Engineering', role: 'EMPLOYEE', isActive: true, lastLoginDays: 12, device: 'Edge on Windows', ip: '157.32.14.60' },
  { id: 'u-13', first: 'Rohan', last: 'Deshmukh', code: 'ACM-1154', designation: 'Support Specialist', department: 'Customer Success', role: 'EMPLOYEE', isActive: false, lastLoginDays: 190, device: 'Chrome on Windows', ip: '157.32.14.71' },
  { id: 'u-14', first: 'Sunita', last: 'Rao', code: 'ACM-0103', designation: 'Internal Auditor', department: 'Compliance', role: 'AUDITOR', isActive: true, lastLoginDays: 5, device: 'Edge on Windows', ip: '103.21.14.30' },
  { id: 'u-15', first: 'System', last: 'Bootstrap', code: '—', designation: 'Break-glass admin', department: 'Leadership', role: 'COMPANY_ADMIN', isActive: false, lastLoginDays: 260, device: null, ip: null, noEmployee: true },
];

const emailFor = (s: Seed) =>
  `${s.first.toLowerCase()}.${s.last.toLowerCase().replace(/[^a-z]/g, '')}@acme.example`;

export function makeUsers(): AccessUser[] {
  return SEEDS.map((s, i) => ({
    id: s.id,
    email: s.noEmployee ? 'admin@acme.example' : emailFor(s),
    role: s.role,
    isActive: s.isActive,
    employee: s.noEmployee
      ? null
      : {
          id: `emp-${s.id}`,
          firstName: s.first,
          lastName: s.last,
          employeeCode: s.code,
          designation: s.designation,
          department: s.department,
        },
    firebaseUid: `fb_${s.id.replace('-', '')}${'x'.repeat(6)}${i}`,
    firebaseDisabled: !s.isActive,
    createdAt: daysAgo(400 - i * 11, 9, 0),
    lastLoginAt: s.lastLoginDays == null ? null : daysAgo(s.lastLoginDays),
    lastLoginIp: s.ip,
    lastLoginDevice: s.device,
  }));
}

export function makeLoginAudit(users: AccessUser[]): LoginAuditEntry[] {
  const byEmail = (e: string) => users.find((u) => u.email === e) ?? null;
  const raw: Array<[number, number, string, LoginAuditEntry['outcome'], string, string]> = [
    [0, 9, 'vikram.sen@acme.example', 'SUCCESS', '103.21.14.8', 'Edge on Windows'],
    [0, 8, 'eleanor.vance@acme.example', 'SUCCESS', '49.36.220.11', 'Chrome on macOS'],
    [0, 7, 'aarav.sharma@acme.example', 'SUCCESS', '49.36.220.77', 'Firefox on Ubuntu'],
    [1, 22, 'unknown@acme.example', 'BAD_CREDENTIALS', '185.220.101.4', 'Chrome on Windows'],
    [1, 21, 'unknown@acme.example', 'BAD_CREDENTIALS', '185.220.101.4', 'Chrome on Windows'],
    [1, 12, 'rajesh.nair@acme.example', 'SUCCESS', '103.21.14.22', 'Chrome on Windows'],
    [2, 15, 'rohan.deshmukh@acme.example', 'USER_INACTIVE', '157.32.14.71', 'Chrome on Windows'],
    [2, 10, 'meera.iyer@acme.example', 'SUCCESS', '49.36.220.40', 'Firefox on Ubuntu'],
    [3, 18, 'aarav.sharma@acme.example', 'TOKEN_EXPIRED', '49.36.220.77', 'Firefox on Ubuntu'],
    [3, 9, 'rohan.mehta@acme.example', 'SUCCESS', '103.21.14.51', 'Chrome on Windows'],
    [4, 3, 'priya.venkataraman@acme.example', 'CLAIM_MISMATCH', '13.232.0.19', 'Chrome on Windows'],
    [4, 11, 'ananya.gupta@acme.example', 'SUCCESS', '106.51.10.88', 'Chrome on macOS'],
    [5, 14, 'sunita.rao@acme.example', 'SUCCESS', '103.21.14.30', 'Edge on Windows'],
    [6, 2, 'karthik.reddy@acme.example', 'USER_INACTIVE', '157.32.14.9', 'Chrome on Android'],
    [7, 8, 'ishaan.patel@acme.example', 'SUCCESS', '103.21.14.90', 'Safari on macOS'],
    [8, 23, 'admin@acme.example', 'BAD_CREDENTIALS', '45.9.148.2', 'curl/8.4.0'],
    [9, 10, 'eleanor.vance@acme.example', 'SUCCESS', '49.36.220.11', 'Chrome on macOS'],
    [11, 16, 'aditya.joshi@acme.example', 'SUCCESS', '157.32.14.60', 'Edge on Windows'],
    [14, 9, 'vikram.sen@acme.example', 'SUCCESS', '103.21.14.8', 'Edge on Windows'],
    [18, 13, 'diya.krishnan@acme.example', 'BAD_CREDENTIALS', '106.51.10.5', 'Chrome on Android'],
    [21, 7, 'rajesh.nair@acme.example', 'SUCCESS', '103.21.14.22', 'Chrome on Windows'],
    [27, 19, 'contractor@acme.example', 'CLAIM_MISMATCH', '20.24.11.3', 'Chrome on Windows'],
  ];
  return raw.map(([d, h, email, outcome, ip, device], i) => ({
    id: `la-${String(i + 1).padStart(3, '0')}`,
    at: daysAgo(d, h, (i * 7) % 60),
    email,
    userId: byEmail(email)?.id ?? null,
    outcome,
    ip,
    userAgent: device,
    deviceLabel: device,
  }));
}

export function makeAccessAudit(): AccessAuditEntry[] {
  const rows: Array<[number, number, string, Role, AccessAuditEntry['action'], string, string | null, string | null, string | null]> = [
    [1, 16, 'Vikram Sen', 'COMPANY_ADMIN', 'role.changed', 'eleanor.vance@acme.example', 'Line Manager', 'HR Manager', 'Promotion to Head of People Ops per FY27 roadmap.'],
    [2, 11, 'Meera Iyer', 'HR_MANAGER', 'user.created', 'diya.krishnan@acme.example', null, 'Employee', 'Onboarded via Employee Master.'],
    [2, 15, 'Meera Iyer', 'HR_MANAGER', 'user.deactivated', 'rohan.deshmukh@acme.example', 'Active', 'Deactivated', 'Voluntary resignation — last working day cleared.'],
    [3, 10, 'Vikram Sen', 'COMPANY_ADMIN', 'user.deactivated', 'karthik.reddy@acme.example', 'Active', 'Deactivated', 'Extended leave of absence — access paused.'],
    [5, 9, 'Eleanor Vance', 'HR_MANAGER', 'password_reset.sent', 'ishaan.patel@acme.example', null, null, 'User reported lockout.'],
    [8, 14, 'Vikram Sen', 'COMPANY_ADMIN', 'role.changed', 'rohan.mehta@acme.example', 'Employee', 'Line Manager', 'Now managing the SMB sales pod.'],
    [12, 12, 'Meera Iyer', 'HR_MANAGER', 'user.created', 'aditya.joshi@acme.example', null, 'Employee', 'Onboarded via Employee Master.'],
    [15, 17, 'Vikram Sen', 'COMPANY_ADMIN', 'role.changed', 'sunita.rao@acme.example', 'Employee', 'Auditor', 'Compliance team — read-only access grant.'],
    [20, 10, 'Rajesh Nair', 'COMPANY_ADMIN', 'password_reset.sent', 'ananya.gupta@acme.example', null, null, null],
    [30, 9, 'Vikram Sen', 'COMPANY_ADMIN', 'user.deactivated', 'admin@acme.example', 'Active', 'Deactivated', 'Bootstrap admin retired after real admins provisioned.'],
    [45, 11, 'Vikram Sen', 'COMPANY_ADMIN', 'role.changed', 'rajesh.nair@acme.example', 'HR Manager', 'Company Admin', 'Co-administrator for the IT org.'],
    [60, 16, 'Vikram Sen', 'COMPANY_ADMIN', 'user.created', 'eleanor.vance@acme.example', null, 'Line Manager', 'First HR hire.'],
  ];
  return rows.map(([d, h, actorName, actorRole, action, targetEmail, before, after, note], i) => ({
    id: `aa-${String(i + 1).padStart(3, '0')}`,
    at: daysAgo(d, h, (i * 11) % 60),
    actorName,
    actorRole,
    action,
    targetEmail,
    before,
    after,
    note,
  }));
}
