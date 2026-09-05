/**
 * Plan → entitlements mapping.
 *
 * Entitlements are the COMMERCIAL boundary: which modules a tenant may use,
 * and which premium integrations are unlocked. They are derived from the
 * subscription `plan` at onboarding and re-derived whenever the plan
 * changes — never edited directly, and never confused with a tenant's HR
 * rules (work week, shift times, …), which are operational config the
 * Company Admin manages in-app (public.tenant_settings et al.).
 *
 * A future `EntitlementGuard` reads `subscription.enabledModules` to gate
 * whole modules (Payroll, Compliance) and `subscription.features` to gate
 * capabilities (biometric device ingestion, custom roles, API access).
 */

export const MODULES = [
  'CORE_HR', // employees, org, dashboard — always on
  'LEAVE',
  'ATTENDANCE',
  'PAYROLL',
  'COMPLIANCE',
] as const;
export type ModuleKey = (typeof MODULES)[number];

export interface PlanFeatures {
  /** Accept punches from biometric/GPS/import channels, not just web. */
  biometricIntegration: boolean;
  /** Company Admin can define custom roles/permissions (not built yet). */
  customRoles: boolean;
  /** Tenant-scoped API keys for outbound integrations (not built yet). */
  apiAccess: boolean;
}

export interface PlanEntitlements {
  enabledModules: ModuleKey[];
  features: PlanFeatures;
}

const NO_FEATURES: PlanFeatures = {
  biometricIntegration: false,
  customRoles: false,
  apiAccess: false,
};

/** Plans a tenant can be onboarded onto (TRIAL is a status, not a sold plan). */
export type SellablePlan = 'STARTER' | 'GROWTH' | 'ENTERPRISE';

const PLAN_ENTITLEMENTS: Record<SellablePlan | 'TRIAL', PlanEntitlements> = {
  TRIAL: {
    enabledModules: ['CORE_HR', 'LEAVE'],
    features: { ...NO_FEATURES },
  },
  STARTER: {
    enabledModules: ['CORE_HR', 'LEAVE'],
    features: { ...NO_FEATURES },
  },
  GROWTH: {
    enabledModules: ['CORE_HR', 'LEAVE', 'ATTENDANCE', 'PAYROLL'],
    features: { ...NO_FEATURES },
  },
  ENTERPRISE: {
    enabledModules: ['CORE_HR', 'LEAVE', 'ATTENDANCE', 'PAYROLL', 'COMPLIANCE'],
    features: { biometricIntegration: true, customRoles: true, apiAccess: true },
  },
};

export function entitlementsForPlan(plan: SellablePlan | 'TRIAL'): PlanEntitlements {
  return PLAN_ENTITLEMENTS[plan] ?? PLAN_ENTITLEMENTS.TRIAL;
}
