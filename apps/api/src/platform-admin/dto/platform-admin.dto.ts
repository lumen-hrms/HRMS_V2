import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

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

  /** Seat ceiling. Omitted → the plan's default. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  seats?: number;
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
