/**
 * Platform Admin (operator console) — frontend contract.
 *
 * Shapes match the REAL `platform` schema (see apps/api/prisma/schema.prisma
 * + docs/modules/02_PLATFORM_ADMIN.md §4.3), not the fuller aspirational
 * model. Fields that don't exist server-side yet are marked TODO(api).
 *
 * ISOLATION CONSTRAINT: nothing here is tenant PII. Only counts and
 * metadata — name, subdomain, plan, seats, employee *count*, status, dates.
 */

export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'TRIAL';

/** Sold plans + the TRIAL enum value (which is really a status). */
export type PlanKey = 'TRIAL' | 'STARTER' | 'GROWTH' | 'ENTERPRISE';
export type SellablePlan = 'STARTER' | 'GROWTH' | 'ENTERPRISE';

export type IsolationTier = 'POOLED' | 'DEDICATED';

export interface Subscription {
  plan: PlanKey;
  seats: number;
  enabledModules: string[];
  features: Record<string, boolean>;
  renewsAt: string | null;
  /**
   * NEGOTIATED per-seat / month rate, snapshotted at assign / renewal.
   * Decimal serialises as string. Effective monthly = pricePerSeat × seats.
   */
  pricePerSeat: string | null;
  isolationTier: IsolationTier;
}

/** One row of the operator-editable plan catalog (`GET /api/platform-admin/plans`). */
export interface Plan {
  key: SellablePlan;
  name: string;
  /** List price per seat per month (Decimal as string). */
  listPricePerSeat: string;
  currency: string;
  /** Default seat count pre-filled at onboarding — not a bundled allotment. */
  seatsIncluded: number;
  enabledModules: string[];
  features: Record<string, boolean>;
  isolationTier: IsolationTier;
  sortOrder: number;
  tenantCount: number;
}

export interface UpdatePlanInput {
  name?: string;
  listPricePerSeat?: number;
  currency?: string;
  seatsIncluded?: number;
  enabledModules?: string[];
  features?: Record<string, boolean>;
  isolationTier?: IsolationTier;
}

/** One row from `GET /api/platform-admin/tenants`. */
export interface TenantRow {
  id: string;
  name: string;
  subdomain: string;
  status: TenantStatus;
  employeeCount: number;
  createdAt: string;
  subscription: Subscription | null;
}

/** `POST /api/platform-admin/tenants` response — `adminResetEmailSent` is
 * false when the hosted reset email failed to send (Firebase quota/config
 * issue); the tenant is still created either way — the wizard should offer
 * a resend rather than silently claiming success. */
export interface CreatedTenant extends TenantRow {
  adminResetEmailSent: boolean;
}

/** `GET /api/platform-admin/tenants/:id` — TODO(api). Superset of TenantRow. */
export interface TenantDetail extends TenantRow {
  firstAdminEmail: string | null; // operator metadata, not tenant PII
  headcountHistory: { at: string; count: number }[]; // TODO(api)
  recentAudit: PlatformAuditEntry[]; // TODO(api) — this tenant's slice
}

export type PlatformAuditAction =
  | 'tenant.created'
  | 'tenant.status_changed'
  | 'tenant.plan_changed'
  | 'subscription.renewed'
  | 'subscription.price_adjusted'
  | 'plan.updated'
  | 'headcount.refreshed'
  | 'breakglass.requested'
  | 'breakglass.used'
  | 'breakglass.expired';

/** `platform.platform_audit_log` row, shaped for the UI. */
export interface PlatformAuditEntry {
  id: string;
  at: string;
  actorEmail: string;
  action: PlatformAuditAction;
  targetTenantName: string | null;
  before: string | null;
  after: string | null;
  note: string | null;
}

export interface CreateTenantInput {
  name: string;
  subdomain: string;
  plan: SellablePlan;
  seats?: number;
  /** Negotiated per-seat rate. Omitted → the plan's list price. */
  pricePerSeat?: number;
  firstAdminName: string;
  firstAdminEmail: string;
}

export interface BreakGlassGrant {
  id: string;
  tenantName: string;
  reason: string;
  grantedAt: string;
  expiresAt: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  accessCount: number;
}

// --- label / colour maps -------------------------------------------------

export const TENANT_STATUS_LABEL: Record<TenantStatus, string> = {
  ACTIVE: 'Active',
  TRIAL: 'Trial',
  SUSPENDED: 'Suspended',
};

export const PLAN_LABEL: Record<PlanKey, string> = {
  TRIAL: 'Trial',
  STARTER: 'Starter',
  GROWTH: 'Growth',
  ENTERPRISE: 'Enterprise',
};

export const AUDIT_ACTION_LABEL: Record<PlatformAuditAction, string> = {
  'tenant.created': 'Tenant created',
  'tenant.status_changed': 'Status changed',
  'tenant.plan_changed': 'Plan changed',
  'subscription.renewed': 'Subscription renewed',
  'subscription.price_adjusted': 'Pricing adjusted',
  'plan.updated': 'Plan catalog edited',
  'headcount.refreshed': 'Headcount refreshed',
  'breakglass.requested': 'Break-glass requested',
  'breakglass.used': 'Break-glass used',
  'breakglass.expired': 'Break-glass expired',
};

/** Effective plan for display — TRIAL status wins over the stored plan. */
export function effectivePlan(t: Pick<TenantRow, 'status' | 'subscription'>): PlanKey {
  if (t.status === 'TRIAL') return 'TRIAL';
  return t.subscription?.plan ?? 'STARTER';
}

/** employeeCount / seats → { pct, tone }. amber ≥ 90 %, red > 100 %. */
export function seatPressure(employeeCount: number, seats: number | undefined) {
  if (!seats || seats <= 0) return { pct: 0, tone: 'muted' as const, over: false };
  const pct = Math.round((employeeCount / seats) * 100);
  const over = employeeCount > seats;
  const tone = over ? ('destructive' as const) : pct >= 90 ? ('warning' as const) : ('success' as const);
  return { pct, tone, over };
}
