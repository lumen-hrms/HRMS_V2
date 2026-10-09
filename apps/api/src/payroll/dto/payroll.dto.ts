import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IndianState, SalaryCalculationMode, SalaryComponentType, TaxRegime } from '@prisma/client';

export const COMPONENT_CODE = /^[A-Z][A-Z0-9_]{0,39}$/;

export class SalaryComponentDto {
  @IsEnum(SalaryComponentType)
  type!: SalaryComponentType;

  // Defaults to the type name for standard components; required for CUSTOM.
  @IsOptional()
  @Matches(COMPONENT_CODE, { message: 'code must be UPPER_SNAKE_CASE, up to 40 characters' })
  code?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsEnum(SalaryCalculationMode)
  calculationMode!: SalaryCalculationMode;

  // FIXED: monthly amount. PERCENT_OF_BASIC / PERCENT_OF_CTC: percentage.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  value?: number;

  @IsOptional()
  @IsString()
  formula?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpsertSalaryStructureDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  ctcAnnual!: number;

  @IsDateString()
  effectiveFrom!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => SalaryComponentDto)
  components!: SalaryComponentDto[];
}

export class UpdatePayrollSettingsDto {
  @IsOptional() @IsNumber() @Min(0) @Max(100) minBasicPercent?: number;

  @IsOptional() @IsNumber() @Min(0) epfCeiling?: number;
  @IsOptional() @IsBoolean() allowEpfAboveCeiling?: boolean;
  @IsOptional() @IsNumber() @Min(0) @Max(100) epfEmployeeRate?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) epsRate?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) epfEmployerRate?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) epfAdminRate?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) edliRate?: number;

  @IsOptional() @IsNumber() @Min(0) esiWageCeiling?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) esiEmployeeRate?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) esiEmployerRate?: number;

  @IsOptional() @IsBoolean() overtimeEnabled?: boolean;
  @IsOptional() @IsNumber() @Min(1) overtimeMultiplier?: number;

  // Full & Final (module 07 §9 Phase 8, decisions 10/17).
  @IsOptional() @IsNumber() @Min(1) leaveEncashmentDivisor?: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  leaveEncashmentComponents?: string[];
  @IsOptional() @IsInt() @Min(0) gratuityEligibilityYears?: number;
  @IsOptional() @IsNumber() @Min(0) gratuityDaysPerYear?: number;
  @IsOptional() @IsNumber() @Min(1) gratuityMonthDivisor?: number;
}

export class PtSlabDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  grossFrom!: number;

  // null / omitted = open-ended (must be the last slab).
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  grossTo?: number | null;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monthlyAmount!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  februaryAmount?: number | null;
}

export class ReplacePtSlabsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PtSlabDto)
  slabs!: PtSlabDto[];
}

export class PtSlabQueryDto {
  @IsOptional()
  @IsEnum(IndianState)
  state?: IndianState;
}

export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class CreatePayrollRunDto {
  @Matches(PERIOD_PATTERN, { message: 'period must be YYYY-MM' })
  period!: string;

  @IsOptional()
  @IsBoolean()
  isReprocess?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reprocessReason?: string;
}

export class AdHocAdjustmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  type!: string; // ADVANCE | BONUS | INCENTIVE | GRATUITY_PAYOUT | other tenant-chosen label

  // Signed: positive adds to net pay (bonus/incentive), negative subtracts
  // (advance/recovery).
  @IsNumber({ maxDecimalPlaces: 2 })
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class SetLineItemAdjustmentsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AdHocAdjustmentDto)
  adjustments!: AdHocAdjustmentDto[];
}

export class PayslipQueryDto {
  @Matches(PERIOD_PATTERN, { message: 'period must be YYYY-MM' })
  period!: string;
}

export class BankFileQueryDto {
  @IsOptional()
  @IsString()
  format?: string;
}

// ---- TDS and regime choice (module 07 §9 Phase 6) ----

export const FINANCIAL_YEAR_PATTERN = /^\d{4}-\d{2}$/;

export class TaxConfigQueryDto {
  @Matches(FINANCIAL_YEAR_PATTERN, { message: 'financialYear must be YYYY-YY' })
  financialYear!: string;
}

export class TaxSlabDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  incomeFrom!: number;

  // null / omitted = open-ended (must be the last slab).
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  incomeTo?: number | null;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  ratePercent!: number;
}

export class ReplaceTaxSlabsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TaxSlabDto)
  slabs!: TaxSlabDto[];
}

export class UpdateTaxRegimeConfigDto {
  @IsOptional() @IsNumber() @Min(0) standardDeduction?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) cessPercent?: number;
  @IsOptional() @IsNumber() @Min(0) rebateThreshold?: number;
  @IsOptional() @IsNumber() @Min(0) rebateMaxAmount?: number;
}

export class SetTdsRegimeDto {
  @Matches(FINANCIAL_YEAR_PATTERN, { message: 'financialYear must be YYYY-YY' })
  financialYear!: string;

  @IsEnum(TaxRegime)
  regime!: TaxRegime;
}

// ---- Salary revisions and arrears (module 07 §9 Phase 7) ----

export class ReviseSalaryStructureDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  ctcAnnual!: number;

  // May be backdated — a date at/before an already-PROCESSED period
  // triggers arrears for every such period.
  @IsDateString()
  effectiveDate!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => SalaryComponentDto)
  components!: SalaryComponentDto[];

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}

// ---- Full & Final settlement (module 07 §9 Phase 8) ----

export class GenerateFnfDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  advanceRecoveryAmount?: number;
}

export class UpdateFnfAdvanceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  advanceRecoveryAmount!: number;
}
