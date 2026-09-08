import { Prisma } from '@prisma/client';
import type { AppRole } from '../common/decorators/roles.decorator';

/**
 * Privilege ceiling — mirrors apps/web/src/lib/roles.ts `ROLE_RANK` /
 * `assignableRoles` so the API and the UI agree on RULE-2 (module 01 §6).
 */
export const ROLE_RANK: Record<AppRole, number> = {
  COMPANY_ADMIN: 4,
  HR_MANAGER: 3,
  LINE_MANAGER: 2,
  AUDITOR: 1,
  EMPLOYEE: 0,
};

export const ROLE_LABELS: Record<AppRole, string> = {
  COMPANY_ADMIN: 'Company Admin',
  HR_MANAGER: 'HR Manager',
  LINE_MANAGER: 'Line Manager',
  EMPLOYEE: 'Employee',
  AUDITOR: 'Auditor',
};

/** Roles `actor` may assign. Only a Company Admin may grant COMPANY_ADMIN. */
export function assignableRoles(actor: AppRole): AppRole[] {
  const all = Object.keys(ROLE_RANK) as AppRole[];
  if (actor === 'COMPANY_ADMIN') return all;
  return all.filter((r) => r !== 'COMPANY_ADMIN' && ROLE_RANK[r] <= ROLE_RANK[actor]);
}

// ---------------------------------------------------------------------------
// Access-change audit — stored in public.audit_log with a namespaced action
// and a self-contained metadata snapshot, so GET /audit?feed=access maps
// straight to the frontend `AccessAuditEntry` shape with no joins and the
// future Audit Log module (12) can still filter this module's rows out by
// prefix or by `metadata.module`.
// ---------------------------------------------------------------------------

export type FrontendAuditAction =
  'role.changed' | 'user.activated' | 'user.deactivated' | 'password_reset.sent' | 'user.created';

/** `role.changed` <-> `access.role_changed` */
export const STORED_ACTION: Record<FrontendAuditAction, string> = {
  'role.changed': 'access.role_changed',
  'user.activated': 'access.user_activated',
  'user.deactivated': 'access.user_deactivated',
  'password_reset.sent': 'access.password_reset_sent',
  'user.created': 'access.user_created',
};

const FRONTEND_ACTION: Record<string, FrontendAuditAction> = Object.fromEntries(
  Object.entries(STORED_ACTION).map(([k, v]) => [v, k as FrontendAuditAction]),
) as Record<string, FrontendAuditAction>;

export function frontendAction(stored: string): FrontendAuditAction | null {
  return FRONTEND_ACTION[stored] ?? null;
}

export const ACCESS_AUDIT_MODULE = 'identity-access';

/**
 * Builds the `public.audit_log` row for one access-change event. Shared by
 * AccessService (role / status / reset) and EmployeesService (login
 * created), so every Identity & Access event is shaped identically and is
 * filterable later by the `access.` action prefix or `metadata.module`.
 */
export function buildAccessAuditData(input: {
  tenantId: string;
  actorUserId: string;
  actorName: string;
  actorRole: string;
  action: FrontendAuditAction;
  targetUserId: string | null;
  targetEmail: string;
  before?: string | null;
  after?: string | null;
  note?: string | null;
}): Prisma.AuditLogUncheckedCreateInput {
  return {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    action: STORED_ACTION[input.action],
    targetType: 'user',
    targetId: input.targetUserId,
    ipAddress: null,
    metadata: {
      module: ACCESS_AUDIT_MODULE,
      actorName: input.actorName,
      actorRole: input.actorRole,
      targetEmail: input.targetEmail,
      before: input.before ?? null,
      after: input.after ?? null,
      note: input.note ?? null,
    } satisfies Prisma.InputJsonObject,
  };
}

/**
 * Very small user-agent → "Chrome on macOS" style label for the login
 * audit UI. Deliberately not a full UA-parsing dependency — good enough to
 * tell a browser/OS pair apart at a glance, "Unknown device" otherwise.
 */
export function deviceLabel(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : /curl\//.test(ua)
              ? 'curl'
              : null;
  const os = /Windows NT/.test(ua)
    ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /(iPhone|iPad|iOS)/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? 'Unknown device';
}

/** Inclusive date-range predicate on an ISO timestamp, by calendar day. */
export function inDateRange(iso: string, from?: string, to?: string): boolean {
  const day = iso.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}
