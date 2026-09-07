import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

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

  @IsString()
  @MinLength(8)
  adminTempPassword!: string;

  /**
   * Sold plan the tenant starts on. Drives the subscription's entitlements
   * (enabled modules + feature flags — see platform-admin/entitlements.ts).
   * Omitted → STARTER. Tenant `status` still begins as TRIAL regardless.
   */
  @IsOptional()
  @IsIn(['STARTER', 'GROWTH', 'ENTERPRISE'])
  plan?: 'STARTER' | 'GROWTH' | 'ENTERPRISE';
}

export class UpdateTenantStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'TRIAL'])
  status!: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
}
