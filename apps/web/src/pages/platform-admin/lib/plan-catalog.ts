import type { SellablePlan } from './types';

/**
 * Plan catalog for the console — mirrors apps/api/src/platform-admin/
 * entitlements.ts (the authoritative source). Prices are INDICATIVE
 * reference figures for the wizard's side-card only: there is no billing
 * system, nothing is charged, and `priceMonthly` is never sent to the API.
 */
export interface PlanCatalogEntry {
  plan: SellablePlan;
  label: string;
  seatsIncluded: number;
  priceMonthly: number; // ₹ / month — indicative only, not billed
  modules: string[]; // matches Subscription.enabledModules
  features: { key: string; label: string; on: boolean }[];
}

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

export const PLAN_CATALOG: Record<SellablePlan, PlanCatalogEntry> = {
  STARTER: {
    plan: 'STARTER',
    label: 'Starter',
    seatsIncluded: 50,
    priceMonthly: 7500,
    modules: ['CORE_HR', 'LEAVE'],
    features: [
      { key: 'biometricIntegration', label: 'Biometric / GPS punch ingestion', on: false },
      { key: 'customRoles', label: 'Custom roles', on: false },
      { key: 'apiAccess', label: 'Tenant API keys', on: false },
    ],
  },
  GROWTH: {
    plan: 'GROWTH',
    label: 'Growth',
    seatsIncluded: 200,
    priceMonthly: 18500,
    modules: ['CORE_HR', 'LEAVE', 'ATTENDANCE', 'PAYROLL'],
    features: [
      { key: 'biometricIntegration', label: 'Biometric / GPS punch ingestion', on: false },
      { key: 'customRoles', label: 'Custom roles', on: false },
      { key: 'apiAccess', label: 'Tenant API keys', on: false },
    ],
  },
  ENTERPRISE: {
    plan: 'ENTERPRISE',
    label: 'Enterprise',
    seatsIncluded: 500,
    priceMonthly: 48000,
    modules: ['CORE_HR', 'LEAVE', 'ATTENDANCE', 'PAYROLL', 'COMPLIANCE'],
    features: [
      { key: 'biometricIntegration', label: 'Biometric / GPS punch ingestion', on: true },
      { key: 'customRoles', label: 'Custom roles', on: true },
      { key: 'apiAccess', label: 'Tenant API keys', on: true },
    ],
  },
};

export const SELLABLE_PLANS: SellablePlan[] = ['STARTER', 'GROWTH', 'ENTERPRISE'];

/** "₹ 7,500" — Indian digit grouping. */
export function inr(amount: number): string {
  return `₹ ${amount.toLocaleString('en-IN')}`;
}
