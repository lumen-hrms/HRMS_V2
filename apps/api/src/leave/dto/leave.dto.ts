import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

const ACCRUAL_FREQUENCIES = ['ANNUAL', 'MONTHLY', 'QUARTERLY'];
const GENDER_RESTRICTIONS = ['ANY', 'MALE', 'FEMALE'];

export class CreateLeaveTypeDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  code!: string;

  @IsOptional()
  @IsString()
  colorToken?: string;

  @IsNumber()
  @Min(0)
  annualQuota!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  carryForwardCap?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minNoticeDays?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsIn(ACCRUAL_FREQUENCIES)
  accrualFrequency?: 'ANNUAL' | 'MONTHLY' | 'QUARTERLY';

  @IsOptional()
  @IsIn(GENDER_RESTRICTIONS)
  genderRestriction?: 'ANY' | 'MALE' | 'FEMALE';

  @IsOptional()
  @IsBoolean()
  paid?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @IsOptional()
  @IsBoolean()
  isCompOff?: boolean;
}

export class UpdateLeaveTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  code?: string;

  @IsOptional()
  @IsString()
  colorToken?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  annualQuota?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  carryForwardCap?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minNoticeDays?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsIn(ACCRUAL_FREQUENCIES)
  accrualFrequency?: 'ANNUAL' | 'MONTHLY' | 'QUARTERLY';

  @IsOptional()
  @IsIn(GENDER_RESTRICTIONS)
  genderRestriction?: 'ANY' | 'MALE' | 'FEMALE';

  @IsOptional()
  @IsBoolean()
  paid?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @IsOptional()
  @IsBoolean()
  isCompOff?: boolean;
}

export class ApplyLeaveDto {
  @IsUUID()
  leaveTypeId!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsBoolean()
  halfDay?: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class DecideLeaveDto {
  @IsOptional()
  @IsString()
  comment?: string;
}

export class CreateHolidayDto {
  @IsDateString()
  date!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  // Named to match the frontend's Holiday.optional field (apps/web/src/lib/leave/types.ts).
  @IsOptional()
  @IsBoolean()
  optional?: boolean;
}

export class UpdateHolidayDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsBoolean()
  optional?: boolean;
}

export class BalanceAdjustmentDto {
  @IsUUID()
  employeeId!: string;

  @IsUUID()
  leaveTypeId!: string;

  @IsInt()
  year!: number;

  @IsNumber()
  delta!: number;

  @IsString()
  @MinLength(1)
  note!: string;
}

export class UpdateLeaveSettingsDto {
  @IsOptional()
  @IsIn([1, 2])
  leaveApprovalLevels?: 1 | 2;

  @IsOptional()
  @IsInt()
  @Min(1)
  leaveEscalationDays?: number;

  @IsOptional()
  @IsBoolean()
  allowLopRequests?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  fyStartMonth?: number;
}
