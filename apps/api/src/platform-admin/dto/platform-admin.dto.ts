import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

const SELLABLE = ['STARTER', 'GROWTH', 'ENTERPRISE'] as const;
export type SellablePlanKey = (typeof SELLABLE)[number];

export class PlatformSessionDto {
  @IsString()
  @MinLength(1)
  idToken!: string;
}

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  companyName!: string;

  @IsString()
  @MinLength(2)
  subdomain!: string;

  @IsEmail()
  adminEmail!: string;

  /** First Company Admin's name — set as the Firebase user's displayName. */
  @IsString()
  @MinLength(2)
  adminName!: string;

  /**
   * Sold plan the tenant starts on. Drives the subscription's entitlements
   * (enabled modules + feature flags — see platform-admin/entitlements.ts).
   * Omitted → STARTER. Tenant `status` still begins as TRIAL regardless.
   */
  @IsOptional()
  @IsIn(['STARTER', 'GROWTH', 'ENTERPRISE'])
  plan?: 'STARTER' | 'GROWTH' | 'ENTERPRISE';

  /** Seat count. Omitted → the plan's default. Effective monthly = pricePerSeat × seats. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  seats?: number;

  /**
   * Negotiated per-seat / month rate for this deal. Omitted → the plan's
   * list price. Stored as the Subscription's snapshot; a catalog edit never
   * changes it.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  pricePerSeat?: number;
}

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateTenantStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'TRIAL'])
  status!: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';

  /** Operator justification — recorded on the platform audit row. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(5)
  reason?: string;
}

/** PATCH /api/platform-admin/tenants/:id/plan */
export class ChangeTenantPlanDto {
  @IsIn(SELLABLE)
  plan!: SellablePlanKey;

  @Transform(trim)
  @IsString()
  @MinLength(5)
  reason!: string;
}

/**
 * PATCH /api/platform-admin/tenants/:id/pricing — the negotiation lever.
 * Adjusts commercials without a plan change. At least one of `pricePerSeat`
 * / `seats` must be present (enforced in the service).
 */
export class AdjustPricingDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  pricePerSeat?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  seats?: number;

  @Transform(trim)
  @IsString()
  @MinLength(5)
  reason!: string;
}

const AUDIT_ACTIONS = [
  'tenant.created',
  'tenant.status_changed',
  'tenant.plan_changed',
  'subscription.renewed',
  'subscription.price_adjusted',
  'plan.updated',
  'headcount.refreshed',
  'breakglass.requested',
  'breakglass.used',
  'breakglass.expired',
  'breakglass.revoked',
] as const;

/** GET /api/platform-admin/audit?tenantId=&action=&from=&to=&q= */
export class PlatformAuditQueryDto {
  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsIn(AUDIT_ACTIONS)
  action?: (typeof AUDIT_ACTIONS)[number];

  @IsOptional()
  @IsString()
  from?: string; // YYYY-MM-DD

  @IsOptional()
  @IsString()
  to?: string; // YYYY-MM-DD

  @IsOptional()
  @IsString()
  q?: string;
}

/** POST /api/platform-admin/tenants/:id/breakglass */
export class RequestBreakGlassDto {
  @Transform(trim)
  @IsString()
  @MinLength(10)
  reason!: string;

  @IsInt()
  @IsIn([15, 30, 60, 120])
  ttlMinutes!: number;
}

/** PATCH /api/platform-admin/plans/:key — every field optional (partial edit). */
export class UpdatePlanDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  name?: string;

  /** List price per seat per month. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  listPricePerSeat?: number;

  @IsOptional()
  @IsString()
  @MinLength(3)
  currency?: string;

  /** Default seat count pre-filled at onboarding — not a bundled allotment. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  seatsIncluded?: number;

  @IsOptional()
  @IsArray()
  @IsIn(['CORE_HR', 'LEAVE', 'ATTENDANCE', 'PAYROLL', 'COMPLIANCE'], { each: true })
  enabledModules?: string[];

  @IsOptional()
  @IsObject()
  features?: Record<string, boolean>;

  @IsOptional()
  @IsIn(['POOLED', 'DEDICATED'])
  isolationTier?: 'POOLED' | 'DEDICATED';
}

/** `PATCH /api/platform-admin/settings` */
export class UpdatePlatformSettingsDto {
  @IsArray()
  @IsEmail({}, { each: true })
  contactNotifyEmails!: string[];
}
