/** Separate, tiny client for the platform-admin console. Deliberately does
 * NOT share state with lib/api.ts beyond the shared Firebase Auth instance
 * (see lib/firebase.ts) — a platform admin session and a tenant user
 * session are different Firebase custom-claim shapes that must never be
 * conflated, even though both come from the one Firebase project.
 *
 * No `X-Tenant-Subdomain` header on any request — the operator console has
 * no tenant concept.
 */
import { auth } from './firebase';
import type {
  CreatedTenant,
  CreateTenantInput,
  Plan,
  PlatformAuditEntry,
  TenantDetail,
  TenantRow,
  TenantStatus,
  UpdatePlanInput,
} from '@/pages/platform-admin/lib/types';

export class PlatformApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(body?.message ?? `Request failed with status ${status}`);
    this.status = status;
    this.body = body;
  }
}

export function isPlatformApiError(e: unknown): e is PlatformApiError {
  return e instanceof PlatformApiError;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');

  const idToken = await auth.currentUser?.getIdToken();
  if (idToken) headers.set('Authorization', `Bearer ${idToken}`);

  const res = await fetch(`/api/platform-admin${path}`, { ...options, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new PlatformApiError(res.status, body);
  return body as T;
}

const raw = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
};

export const platformApi = {
  ...raw,

  /** `POST /auth/session` — exchange a platform-admin ID token for a session. */
  session(idToken: string) {
    return raw.post<{ status: string; admin: { sub: string; email: string } }>('/auth/session', {
      idToken,
    });
  },

  /** `GET /tenants` — the fleet. */
  listTenants() {
    return raw.get<TenantRow[]>('/tenants');
  },

  /** `POST /tenants` — create tenant + seed first Company Admin (reset email). */
  createTenant(input: CreateTenantInput) {
    return raw.post<CreatedTenant>('/tenants', {
      companyName: input.name,
      subdomain: input.subdomain,
      adminEmail: input.firstAdminEmail,
      adminName: input.firstAdminName,
      plan: input.plan,
      seats: input.seats,
      pricePerSeat: input.pricePerSeat,
    });
  },

  /** `POST /tenants/:id/resend-admin-reset` — re-fire the Company Admin's hosted reset email. */
  resendAdminReset(id: string) {
    return raw.post<{ email: string }>(`/tenants/${id}/resend-admin-reset`);
  },

  /** `PATCH /tenants/:id/status` — ACTIVE / SUSPENDED / TRIAL + audit reason. */
  setStatus(id: string, status: TenantStatus, reason: string) {
    return raw.patch<TenantRow>(`/tenants/${id}/status`, { status, reason });
  },

  /** `GET /plans` — the operator-editable plan catalog + per-plan tenant counts. */
  listPlans() {
    return raw.get<Plan[]>('/plans');
  },

  /** `PATCH /plans/:key` — edit pricing / seats / modules / features / isolation tier. */
  updatePlan(key: string, input: UpdatePlanInput) {
    return raw.patch<Plan>(`/plans/${key}`, input);
  },

  /** `PATCH /tenants/:id/plan` — re-snapshot the tenant onto a different plan. */
  changePlan(id: string, plan: string, reason: string) {
    return raw.patch<TenantRow>(`/tenants/${id}/plan`, { plan, reason });
  },

  /** `POST /tenants/:id/renew` — renew a term; re-snapshots the current plan definition. */
  renew(id: string) {
    return raw.post<TenantRow>(`/tenants/${id}/renew`);
  },

  /**
   * `PATCH /tenants/:id/pricing` — the negotiation lever. Adjust the
   * negotiated per-seat rate and/or seat count without a plan change.
   */
  adjustPricing(id: string, input: { pricePerSeat?: number; seats?: number; reason: string }) {
    return raw.patch<TenantRow>(`/tenants/${id}/pricing`, input);
  },

  /** `GET /audit` — the platform audit log (docs/modules/02_PLATFORM_ADMIN.md §9, item 1). */
  getAudit(params: { tenantId?: string; action?: string; from?: string; to?: string; q?: string }) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v) as [string, string][],
    ).toString();
    return raw.get<PlatformAuditEntry[]>(`/audit${qs ? `?${qs}` : ''}`);
  },

  // ---- TODO(api): endpoints not built yet — these will 404 until the
  //      backend catches up (docs/modules/02_PLATFORM_ADMIN.md §9). Screens
  //      call them and degrade gracefully.

  /** TODO(api) `GET /tenants/:id` */
  getTenant(id: string) {
    return raw.get<TenantDetail>(`/tenants/${id}`);
  },

  /** TODO(api) `POST /tenants/:id/refresh-headcount` */
  refreshHeadcount(id: string) {
    return raw.post<{ employeeCount: number }>(`/tenants/${id}/refresh-headcount`);
  },

  /** TODO(api) `POST /tenants/:id/breakglass` */
  requestBreakGlass(id: string, reason: string, ttlMinutes: number) {
    return raw.post<{ id: string; expiresAt: string }>(`/tenants/${id}/breakglass`, {
      reason,
      ttlMinutes,
    });
  },
};
