import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';

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
}

export class UpdateTenantStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'TRIAL'])
  status!: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
}
