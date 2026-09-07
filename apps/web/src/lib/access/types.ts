/**
 * Identity & Access module — frontend contract.
 *
 * This is the shape every Access-management screen (Users, Audit, My Account)
 * is built against. It is deliberately the FULL intended surface from
 * `docs/modules/01_IDENTITY_AND_ACCESS.md` §4.4 + §9, not just what the API
 * returns today. The access-management endpoints and the `LoginAuditEntry`
 * table are not built yet (§9 gaps 1 + 3) — every call that needs them is
 * marked `planned` in client.ts and served from fixtures.ts so the screens
 * are runnable now and the backend has a concrete target.
 *
 * When packages/shared-types starts carrying real DTOs, these move there and
 * this file re-exports them.
 */
import type { Role } from '@/lib/roles';

export type UserStatus = 'ACTIVE' | 'INACTIVE';

/** Linked Employee Master record — null when a login has no employee row yet. */
export interface AccessUserEmployee {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  designation: string;
  department: string | null;
}

/** One row in Access › Users — auth identity for a tenant person. */
export interface AccessUser {
  id: string;
  email: string;
  role: Role;
  isActive: boolean;
  employee: AccessUserEmployee | null;
  /** Firebase UID — shown in the detail drawer's security block. */
  firebaseUid: string;
  /** True once the Firebase user itself is disabled (mirrors isActive). */
  firebaseDisabled: boolean;
  createdAt: string; // ISO UTC
  lastLoginAt: string | null; // ISO UTC
  lastLoginIp: string | null; // planned — from LoginAuditEntry
  lastLoginDevice: string | null; // planned — parsed UA
}

export interface ChangeRoleInput {
  userId: string;
  newRole: Role;
  /** Audit reason — required, min 5 chars (§5.4). */
  reason: string;
}

export interface SetUserStatusInput {
  userId: string;
  isActive: boolean;
  /** Audit reason — required. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Audit trail — Access › Audit. Both feeds are `planned` (§9 gap 1).
// ---------------------------------------------------------------------------

export type LoginOutcome =
  | 'SUCCESS'
  | 'BAD_CREDENTIALS'
  | 'USER_INACTIVE'
  | 'TENANT_SUSPENDED'
  | 'CLAIM_MISMATCH'
  | 'TOKEN_EXPIRED';

export interface LoginAuditEntry {
  id: string;
  at: string; // ISO UTC
  email: string;
  userId: string | null;
  outcome: LoginOutcome;
  ip: string;
  userAgent: string;
  /** Human label parsed from the UA, e.g. "Chrome on macOS". */
  deviceLabel: string;
}

export type AccessAuditAction =
  | 'role.changed'
  | 'user.activated'
  | 'user.deactivated'
  | 'password_reset.sent'
  | 'user.created';

export interface AccessAuditEntry {
  id: string;
  at: string; // ISO UTC
  actorName: string;
  actorRole: Role;
  action: AccessAuditAction;
  targetEmail: string;
  before: string | null;
  after: string | null;
  note: string | null;
}

export interface LoginAuditFilter {
  outcome?: LoginOutcome | 'ALL';
  from?: string;
  to?: string;
  q?: string;
}

export interface AccessAuditFilter {
  action?: AccessAuditAction | 'ALL';
  from?: string;
  to?: string;
  q?: string;
}

// ---------------------------------------------------------------------------
// Label maps (as-const, no enums — repo TS config forbids enum/namespace).
// ---------------------------------------------------------------------------

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Deactivated',
};

export const LOGIN_OUTCOME_LABELS: Record<LoginOutcome, string> = {
  SUCCESS: 'Signed in',
  BAD_CREDENTIALS: 'Bad credentials',
  USER_INACTIVE: 'Inactive user',
  TENANT_SUSPENDED: 'Tenant suspended',
  CLAIM_MISMATCH: 'Wrong tenant',
  TOKEN_EXPIRED: 'Token expired',
};

export const ACCESS_ACTION_LABELS: Record<AccessAuditAction, string> = {
  'role.changed': 'Role changed',
  'user.activated': 'Login reactivated',
  'user.deactivated': 'Login deactivated',
  'password_reset.sent': 'Password reset sent',
  'user.created': 'Login created',
};
