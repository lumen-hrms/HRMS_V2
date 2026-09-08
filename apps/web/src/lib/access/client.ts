/**
 * Identity & Access module API client.
 *
 * Every method documents the real endpoint it maps to and whether that
 * endpoint exists today (`live`) or is a near-term gap (`planned`, see
 * `docs/modules/01_IDENTITY_AND_ACCESS.md` §9). Screens only ever import
 * from here.
 *
 * The NestJS `access` module is live (`GET /api/access/users`, `/access/me`,
 * `PATCH .../role`, `PATCH .../status`, `POST .../password-reset`,
 * `GET /api/access/audit`, `GET .../:id/activity`), so `USE_MOCK` now
 * defaults to **off**. Set `VITE_ACCESS_MOCK=true` to force the in-memory
 * fixture store back on (design review, offline, storybook).
 *
 * Server-side rules this client mirrors so the mock behaves like the real API
 * (all are also enforced by the backend guard chain / service layer):
 *  - RULE-2 privilege ceiling — an actor may only assign a role ≤ their own;
 *    only a Company Admin may assign COMPANY_ADMIN.
 *  - A workspace must keep ≥ 1 active Company Admin.
 *  - You cannot deactivate your own login.
 *  - Role change takes effect on the user's next token refresh (≤ 1 h).
 */
import { api } from '@/lib/api';
import { assignableRoles, ROLE_LABELS, type Role } from '@/lib/roles';
import { makeAccessAudit, makeLoginAudit, makeUsers, MOCK_TENANT_NAME } from './fixtures';
import type {
  AccessAuditEntry,
  AccessAuditFilter,
  AccessSelf,
  AccessUser,
  ChangeRoleInput,
  LoginAuditEntry,
  LoginAuditFilter,
  SetUserStatusInput,
} from './types';

export const USE_MOCK = import.meta.env.VITE_ACCESS_MOCK === 'true';

/** Who is making the call — the real API reads this from the bearer token. */
export interface AccessCtx {
  userId: string;
  role: Role;
  name: string;
  email: string;
}

export class AccessRuleError extends Error {}

// ---------------------------------------------------------------------------
// Mock store — mutable copies so a session's actions stick until reload.
// ---------------------------------------------------------------------------
const users = makeUsers();
const store = {
  users,
  loginAudit: makeLoginAudit(users),
  accessAudit: makeAccessAudit(),
};

function delay<T>(value: T, ms = 240): Promise<T> {
  return new Promise((res) => setTimeout(() => res(value), ms));
}
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
function nowIso() {
  return new Date().toISOString();
}
function auditId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function activeCompanyAdmins(): AccessUser[] {
  return store.users.filter((u) => u.role === 'COMPANY_ADMIN' && u.isActive);
}

function inRange(iso: string, from?: string, to?: string): boolean {
  if (from && iso.slice(0, 10) < from) return false;
  if (to && iso.slice(0, 10) > to) return false;
  return true;
}

// ---------------------------------------------------------------------------

export const accessApi = {
  /** `GET /api/access/me` · any authenticated tenant user · live */
  getMe(): Promise<AccessSelf> {
    if (USE_MOCK) {
      const self =
        store.users.find((u) => u.role === 'COMPANY_ADMIN' && u.isActive) ?? store.users[0];
      return delay({ ...clone(self), tenantName: MOCK_TENANT_NAME });
    }
    return api.get<AccessSelf>('/access/me');
  },

  /** `GET /api/access/users` · Company Admin, HR Manager, Auditor · live */
  listUsers(): Promise<AccessUser[]> {
    if (USE_MOCK) {
      return delay(
        clone(store.users).sort((a, b) => a.email.localeCompare(b.email)),
      );
    }
    return api.get<AccessUser[]>('/access/users');
  },

  /** `PATCH /api/access/users/:id/role` · Company Admin only · live */
  changeRole(input: ChangeRoleInput, ctx: AccessCtx): Promise<AccessUser> {
    if (USE_MOCK) {
      const u = store.users.find((x) => x.id === input.userId);
      if (!u) return Promise.reject(new AccessRuleError('User not found'));
      if (u.role === input.newRole) {
        return Promise.reject(new AccessRuleError('That is already this user’s role.'));
      }
      if (!assignableRoles(ctx).includes(input.newRole)) {
        return Promise.reject(
          new AccessRuleError('Only a Company Admin can grant that role.'),
        );
      }
      if (input.reason.trim().length < 5) {
        return Promise.reject(new AccessRuleError('A reason of at least 5 characters is required.'));
      }
      if (
        u.role === 'COMPANY_ADMIN' &&
        u.isActive &&
        activeCompanyAdmins().length <= 1
      ) {
        return Promise.reject(
          new AccessRuleError('A workspace must keep at least one active Company Admin.'),
        );
      }
      const before = ROLE_LABELS[u.role];
      u.role = input.newRole;
      store.accessAudit.unshift({
        id: auditId('aa'),
        at: nowIso(),
        actorName: ctx.name,
        actorRole: ctx.role,
        action: 'role.changed',
        targetEmail: u.email,
        before,
        after: ROLE_LABELS[input.newRole],
        note: input.reason.trim(),
      });
      return delay(clone(u));
    }
    return api.patch<AccessUser>(`/access/users/${input.userId}/role`, {
      newRole: input.newRole,
      reason: input.reason,
    });
  },

  /** `PATCH /api/access/users/:id/status` · Company Admin, HR Manager · live */
  setStatus(input: SetUserStatusInput, ctx: AccessCtx): Promise<AccessUser> {
    if (USE_MOCK) {
      const u = store.users.find((x) => x.id === input.userId);
      if (!u) return Promise.reject(new AccessRuleError('User not found'));
      if (!input.isActive && u.id === ctx.userId) {
        return Promise.reject(new AccessRuleError('You can’t deactivate your own account.'));
      }
      if (
        !input.isActive &&
        u.role === 'COMPANY_ADMIN' &&
        u.isActive &&
        activeCompanyAdmins().length <= 1
      ) {
        return Promise.reject(
          new AccessRuleError('A workspace must keep at least one active Company Admin.'),
        );
      }
      if (input.reason.trim().length < 5) {
        return Promise.reject(new AccessRuleError('A reason of at least 5 characters is required.'));
      }
      u.isActive = input.isActive;
      u.firebaseDisabled = !input.isActive;
      store.accessAudit.unshift({
        id: auditId('aa'),
        at: nowIso(),
        actorName: ctx.name,
        actorRole: ctx.role,
        action: input.isActive ? 'user.activated' : 'user.deactivated',
        targetEmail: u.email,
        before: input.isActive ? 'Deactivated' : 'Active',
        after: input.isActive ? 'Active' : 'Deactivated',
        note: input.reason.trim(),
      });
      return delay(clone(u));
    }
    return api.patch<AccessUser>(`/access/users/${input.userId}/status`, {
      isActive: input.isActive,
      reason: input.reason,
    });
  },

  /** `POST /api/access/users/:id/password-reset` · Company Admin, HR Manager · live */
  sendPasswordReset(userId: string, ctx: AccessCtx): Promise<{ email: string }> {
    if (USE_MOCK) {
      const u = store.users.find((x) => x.id === userId);
      if (!u) return Promise.reject(new AccessRuleError('User not found'));
      store.accessAudit.unshift({
        id: auditId('aa'),
        at: nowIso(),
        actorName: ctx.name,
        actorRole: ctx.role,
        action: 'password_reset.sent',
        targetEmail: u.email,
        before: null,
        after: null,
        note: 'Firebase hosted reset email dispatched.',
      });
      return delay({ email: u.email });
    }
    return api.post<{ email: string }>(`/access/users/${userId}/password-reset`);
  },

  /** `GET /api/access/audit?feed=login` · Company Admin, Auditor · live */
  loginAudit(filter: LoginAuditFilter = {}): Promise<LoginAuditEntry[]> {
    if (USE_MOCK) {
      let rows = clone(store.loginAudit);
      if (filter.outcome && filter.outcome !== 'ALL') {
        rows = rows.filter((r) => r.outcome === filter.outcome);
      }
      rows = rows.filter((r) => inRange(r.at, filter.from, filter.to));
      if (filter.q) {
        const q = filter.q.toLowerCase();
        rows = rows.filter(
          (r) => r.email.toLowerCase().includes(q) || r.ip.includes(q),
        );
      }
      return delay(rows.sort((a, b) => b.at.localeCompare(a.at)));
    }
    const qs = new URLSearchParams({ feed: 'login', ...cleanFilter(filter) }).toString();
    return api.get<LoginAuditEntry[]>(`/access/audit?${qs}`);
  },

  /** `GET /api/access/audit?feed=access` · Company Admin, Auditor · live */
  accessAudit(filter: AccessAuditFilter = {}): Promise<AccessAuditEntry[]> {
    if (USE_MOCK) {
      let rows = clone(store.accessAudit);
      if (filter.action && filter.action !== 'ALL') {
        rows = rows.filter((r) => r.action === filter.action);
      }
      rows = rows.filter((r) => inRange(r.at, filter.from, filter.to));
      if (filter.q) {
        const q = filter.q.toLowerCase();
        rows = rows.filter(
          (r) =>
            r.targetEmail.toLowerCase().includes(q) ||
            r.actorName.toLowerCase().includes(q),
        );
      }
      return delay(rows.sort((a, b) => b.at.localeCompare(a.at)));
    }
    const qs = new URLSearchParams({ feed: 'access', ...cleanFilter(filter) }).toString();
    return api.get<AccessAuditEntry[]>(`/access/audit?${qs}`);
  },

  /**
   * Merged recent activity for one user (last N login + access-change items),
   * for the detail drawer. Real API: `GET /api/access/users/:id/activity`
   * (planned) — today it's derived client-side from the two audit feeds.
   */
  recentActivityFor(
    userId: string,
    email: string,
    limit = 6,
  ): Promise<Array<{ kind: 'login' | 'access'; at: string; label: string; detail: string }>> {
    if (USE_MOCK) {
      const logins = store.loginAudit
        .filter((r) => r.userId === userId || r.email === email)
        .map((r) => ({
          kind: 'login' as const,
          at: r.at,
          label: r.outcome === 'SUCCESS' ? 'Signed in' : 'Sign-in failed',
          detail: `${r.deviceLabel ?? 'Unknown device'} · ${r.ip}`,
        }));
      const changes = store.accessAudit
        .filter((r) => r.targetEmail === email)
        .map((r) => ({
          kind: 'access' as const,
          at: r.at,
          label: labelForAction(r.action),
          detail:
            r.before && r.after
              ? `${r.before} → ${r.after} · by ${r.actorName}`
              : `by ${r.actorName}`,
        }));
      return delay(
        [...logins, ...changes]
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, limit),
      );
    }
    return api.get(`/access/users/${userId}/activity`);
  },
};

function cleanFilter(f: object): Record<string, string> {
  return Object.fromEntries(
    Object.entries(f).filter(([, v]) => typeof v === 'string' && v && v !== 'ALL') as [
      string,
      string,
    ][],
  );
}

function labelForAction(a: AccessAuditEntry['action']): string {
  const map: Record<AccessAuditEntry['action'], string> = {
    'role.changed': 'Role changed',
    'user.activated': 'Login reactivated',
    'user.deactivated': 'Login deactivated',
    'password_reset.sent': 'Password reset sent',
    'user.created': 'Login created',
  };
  return map[a];
}
