import { IsOptional, IsString } from 'class-validator';

/**
 * `PATCH /api/tenant-config/company-profile`. Shape-only here; the business
 * rules (required fields, PIN/GSTIN/CIN formats) live in `companyProfileErrors`
 * so company setup applies the identical checks.
 */
export class UpdateCompanyProfileDto {
  @IsString() legalName!: string;
  @IsString() addressLine1!: string;
  @IsOptional() @IsString() addressLine2?: string;
  @IsString() city!: string;
  @IsString() state!: string;
  @IsString() pincode!: string;
  @IsString() contactEmail!: string;
  @IsString() contactPhone!: string;
  @IsOptional() @IsString() gstin?: string;
  @IsOptional() @IsString() cin?: string;
}
