/**
 * Tenant roles (mirror of the API `UserRole` enum, minus PLATFORM_ADMIN which
 * lives in the structurally-separate platform console). Keep this list and the
 * helpers below as the single source of truth for "who can see what" on the
 * frontend — screens and nav both read from here so a role change is one edit.
 *
 * Guard chain on the server is still authoritative (JwtAuthGuard → TenantGuard →
 * RolesGuard + service-layer row scoping); these helpers only decide what to
 * render so a user isn't shown a control the API would reject.
 */
import type { CurrentUser } from '@/context/auth-context';

export type Role = CurrentUser['role'];

export const ROLE_LABELS: Record<Role, string> = {
  COMPANY_ADMIN: 'Company Admin',
  HR_MANAGER: 'HR Manager',
  LINE_MANAGER: 'Line Manager',
  EMPLOYEE: 'Employee',
  AUDITOR: 'Auditor',
};

/** Full HR administration of a module (config, org-wide data, adjustments). */
export const LEAVE_ADMIN_ROLES: Role[] = ['COMPANY_ADMIN', 'HR_MANAGER'];

/** Can action (approve/reject) leave requests routed to them. */
export const LEAVE_APPROVER_ROLES: Role[] = ['COMPANY_ADMIN', 'HR_MANAGER', 'LINE_MANAGER'];

/** Sees a team (own + direct/indirect reports) rather than just themselves. */
export const TEAM_VIEW_ROLES: Role[] = ['COMPANY_ADMIN', 'HR_MANAGER', 'LINE_MANAGER'];

export function hasRole(user: { role: Role } | null | undefined, roles: Role[]): boolean {
  return !!user && roles.includes(user.role);
}

export const isLeaveAdmin = (u: { role: Role } | null | undefined) => hasRole(u, LEAVE_ADMIN_ROLES);
export const isLeaveApprover = (u: { role: Role } | null | undefined) =>
  hasRole(u, LEAVE_APPROVER_ROLES);
export const hasTeamView = (u: { role: Role } | null | undefined) => hasRole(u, TEAM_VIEW_ROLES);
export const isAuditor = (u: { role: Role } | null | undefined) => u?.role === 'AUDITOR';
/** Read-only roles never see mutating controls anywhere in a module. */
export const isReadOnly = (u: { role: Role } | null | undefined) => u?.role === 'AUDITOR';

export const isCompanyAdmin = (u: { role: Role } | null | undefined) => u?.role === 'COMPANY_ADMIN';

// --- Identity & Access module (see docs/modules/01_IDENTITY_AND_ACCESS.md §8) --

/** Privilege ceiling, high → low. `atLeast` compares against it. */
export const ROLE_RANK: Record<Role, number> = {
  COMPANY_ADMIN: 4,
  HR_MANAGER: 3,
  LINE_MANAGER: 2,
  AUDITOR: 1,
  EMPLOYEE: 0,
};

export function atLeast(u: { role: Role } | null | undefined, role: Role): boolean {
  return !!u && ROLE_RANK[u.role] >= ROLE_RANK[role];
}

/** Sees the Access module at all (list + audit). Auditor is read-only within. */
export const ACCESS_VIEW_ROLES: Role[] = ['COMPANY_ADMIN', 'HR_MANAGER', 'AUDITOR'];
/** Can activate/deactivate a login and send a password-reset link. */
export const USER_ADMIN_ROLES: Role[] = ['COMPANY_ADMIN', 'HR_MANAGER'];
/** Can read the login / access-change audit trail. */
export const AUDIT_READ_ROLES: Role[] = ['COMPANY_ADMIN', 'AUDITOR'];

export const canViewAccessModule = (u: { role: Role } | null | undefined) =>
  hasRole(u, ACCESS_VIEW_ROLES);
export const canManageUsers = (u: { role: Role } | null | undefined) => hasRole(u, USER_ADMIN_ROLES);
/** RULE-2: only a Company Admin changes an existing user's role. */
export const canChangeUserRole = (u: { role: Role } | null | undefined) => isCompanyAdmin(u);
export const canReadAudit = (u: { role: Role } | null | undefined) => hasRole(u, AUDIT_READ_ROLES);

/**
 * Roles an actor may assign (RULE-2 privilege ceiling). Company Admin can
 * assign anything including COMPANY_ADMIN; anyone else caps at their own rank
 * and never grants COMPANY_ADMIN.
 */
export function assignableRoles(actor: { role: Role } | null | undefined): Role[] {
  const all: Role[] = ['COMPANY_ADMIN', 'HR_MANAGER', 'LINE_MANAGER', 'EMPLOYEE', 'AUDITOR'];
  if (isCompanyAdmin(actor)) return all;
  const ceiling = actor ? ROLE_RANK[actor.role] : -1;
  return all.filter((r) => r !== 'COMPANY_ADMIN' && ROLE_RANK[r] <= ceiling);
}
