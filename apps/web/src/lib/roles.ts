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
