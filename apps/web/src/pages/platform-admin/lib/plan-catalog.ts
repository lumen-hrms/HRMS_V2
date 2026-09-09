import type { SellablePlan } from './types';

/**
 * Static labels for the plan catalog. The plan *data* (price, seats,
 * modules, features, isolation tier) now lives in `platform.plans` and is
 * fetched via `platformApi.listPlans()` — it is operator-editable from the
 * Plans screen. Only the display strings are hard-coded here.
 */

export const SELLABLE_PLANS: SellablePlan[] = ['STARTER', 'GROWTH', 'ENTERPRISE'];

/** Every module a plan can grant (matches api entitlements.ts MODULES). */
export const ALL_MODULES = ['CORE_HR', 'LEAVE', 'ATTENDANCE', 'PAYROLL', 'COMPLIANCE'] as const;

const MODULE_LABEL: Record<string, string> = {
  CORE_HR: 'Core HR (employees, org, dashboard)',
  LEAVE: 'Leave & approvals',
  ATTENDANCE: 'Attendance & time',
  PAYROLL: 'Payroll & statutory',
  COMPLIANCE: 'Statutory compliance exports',
};

export function moduleLabel(key: string): string {
  return MODULE_LABEL[key] ?? key;
}

/** The feature flags a plan can toggle (matches api PlanFeatures). */
export const FEATURE_KEYS = ['biometricIntegration', 'customRoles', 'apiAccess'] as const;

export const FEATURE_LABEL: Record<string, string> = {
  biometricIntegration: 'Biometric / GPS punch ingestion',
  customRoles: 'Custom roles',
  apiAccess: 'Tenant API keys',
};

export function featureLabel(key: string): string {
  return FEATURE_LABEL[key] ?? key;
}

/** "₹ 7,500" — Indian digit grouping. Accepts number or Decimal-string. */
export function inr(amount: number | string, currency = 'INR'): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  const symbol = currency === 'INR' ? '₹' : currency + ' ';
  return `${symbol} ${(Number.isFinite(n) ? n : 0).toLocaleString('en-IN')}`;
}

/**
 * Effective monthly charge = per-seat rate × seat count. Pricing is per
 * seat / month everywhere in the console; the whole-plan figure is always
 * derived, never stored.
 */
export function monthlyTotal(pricePerSeat: number | string | null, seats: number | null): number {
  const rate = typeof pricePerSeat === 'string' ? Number(pricePerSeat) : (pricePerSeat ?? 0);
  return (Number.isFinite(rate) ? rate : 0) * (seats ?? 0);
}
