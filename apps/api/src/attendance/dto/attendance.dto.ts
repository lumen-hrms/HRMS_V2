import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';

const SHIFT_TYPES = ['FIXED', 'FLEXI', 'ROTATIONAL'] as const;
const ATTENDANCE_MODES = ['SELF_SERVICE', 'ROSTER', 'OFF'] as const;
const ATTENDANCE_SOURCES = ['WEB', 'BIOMETRIC', 'GPS', 'IMPORT', 'MANUAL'] as const;
const UNACTIONED_BEHAVIORS = ['AUTO_APPROVE', 'AUTO_REJECT'] as const;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateShiftDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsIn(SHIFT_TYPES)
  type?: (typeof SHIFT_TYPES)[number];

  @Matches(HHMM, { message: 'startTime must be HH:MM' })
  startTime!: string;

  @Matches(HHMM, { message: 'endTime must be HH:MM' })
  endTime!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(180)
  graceMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(24)
  minHoursFullDay?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(24)
  minHoursHalfDay?: number;

  @IsOptional()
  @Matches(HHMM, { message: 'coreStartTime must be HH:MM' })
  coreStartTime?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'coreEndTime must be HH:MM' })
  coreEndTime?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateShiftDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsIn(SHIFT_TYPES)
  type?: (typeof SHIFT_TYPES)[number];

  @IsOptional()
  @Matches(HHMM, { message: 'startTime must be HH:MM' })
  startTime?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'endTime must be HH:MM' })
  endTime?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(180)
  graceMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(24)
  minHoursFullDay?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(24)
  minHoursHalfDay?: number;

  @IsOptional()
  @Matches(HHMM, { message: 'coreStartTime must be HH:MM' })
  coreStartTime?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'coreEndTime must be HH:MM' })
  coreEndTime?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/** `GET`/`PATCH /api/attendance/settings` — merges `attendance_settings`
 *  with the general (non-Leave) slice of `tenant_settings`. */
export class UpdateAttendanceSettingsDto {
  @IsOptional()
  @IsIn(ATTENDANCE_MODES)
  mode?: (typeof ATTENDANCE_MODES)[number];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ATTENDANCE_SOURCES.length)
  @IsIn(ATTENDANCE_SOURCES, { each: true })
  captureMethods?: (typeof ATTENDANCE_SOURCES)[number][];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  regularizationWindowDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  regularizationMonthlyCap?: number;

  @IsOptional()
  @IsIn(UNACTIONED_BEHAVIORS)
  unactionedBehavior?: (typeof UNACTIONED_BEHAVIORS)[number];

  @IsOptional()
  @IsString()
  @MinLength(1)
  timezone?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsIn([0, 1, 2, 3, 4, 5, 6], { each: true })
  weeklyOffDays?: number[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  payrollCutoffDay?: number;
}

const REASON_TYPES = [
  'MISSED_PUNCH_IN',
  'MISSED_PUNCH_OUT',
  'WRONG_PUNCH_TIME',
  'FORGOT_TO_CLOCK_IN',
  'FORGOT_TO_CLOCK_OUT',
  'ON_DUTY_FIELD_WORK',
  'OTHER',
] as const;

export class CreateRegularizationDto {
  @IsDateString()
  targetDate!: string;

  @IsEnum(REASON_TYPES)
  reasonType!: (typeof REASON_TYPES)[number];

  @IsOptional()
  @IsString()
  requestedCheckInAt?: string;

  @IsOptional()
  @IsString()
  requestedCheckOutAt?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

/** `POST regularization/:id/approve|reject` */
export class DecideRegularizationDto {
  @IsOptional()
  @IsString()
  comment?: string;
}

/** `POST regularization/bulk-approve` */
export class BulkDecideRegularizationDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  ids!: string[];
}

const MARK_STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'HOLIDAY', 'WEEKLY_OFF', 'ON_LEAVE'] as const;

/** `POST /attendance/mark` — manual marking by HR (FR-ATT-001), always
 *  reasoned + audited. */
export class MarkAttendanceDto {
  @IsUUID()
  employeeId!: string;

  @IsDateString()
  date!: string;

  @IsIn(MARK_STATUSES)
  status!: (typeof MARK_STATUSES)[number];

  @IsOptional()
  @IsString()
  checkInAt?: string;

  @IsOptional()
  @IsString()
  checkOutAt?: string;

  @IsString()
  @MinLength(5)
  reason!: string;
}
