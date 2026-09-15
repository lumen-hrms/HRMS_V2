export interface AuthenticatedPlatformAdmin {
  sub: string;
  email: string;
}

/** Mirrors apps/web/src/pages/platform-admin/lib/types.ts PlatformAuditAction. */
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

/** `GET /api/platform-admin/audit` row — shaped for the console's Audit
 * screen and the tenant-detail Activity tab. */
export interface PlatformAuditEntryDto {
  id: string;
  at: string;
  actorEmail: string;
  action: PlatformAuditAction;
  targetTenantName: string | null;
  before: string | null;
  after: string | null;
  note: string | null;
}
