import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

export class CreateLeaveTypeDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsNumber()
  @Min(0)
  annualQuota!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  carryForwardCap?: number;
}

export class ApplyLeaveDto {
  @IsUUID()
  leaveTypeId!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class DecideLeaveDto {
  @IsOptional()
  @IsString()
  comment?: string;
}
