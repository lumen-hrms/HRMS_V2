import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

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
