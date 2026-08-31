import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';

export class PlatformLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

export class PlatformMfaVerifyDto {
  @IsString()
  mfaChallengeToken!: string;

  @IsString()
  @MinLength(6)
  code!: string;
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
}

export class UpdateTenantStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'TRIAL'])
  status!: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
}
