import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  MinLength,
} from 'class-validator';

export const LIFECYCLE_STATES = [
  'PRE_JOINING',
  'PROBATION',
  'CONFIRMED',
  'NOTICE_PERIOD',
  'SUSPENDED',
  'SEPARATED',
] as const;

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT'];
const TAX_REGIMES = ['OLD', 'NEW'];
const BANK_ACCOUNT_TYPES = ['SAVINGS', 'CURRENT'];
export const DOCUMENT_CATEGORIES = [
  'OFFER_LETTER',
  'ID_PROOF',
  'ADDRESS_PROOF',
  'EDUCATION',
  'EXPERIENCE',
  'OTHER',
] as const;

const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const AADHAAR_LAST4_PATTERN = /^\d{4}$/;

export class CreateEmployeeDto {
  @IsString()
  @MinLength(1)
  employeeCode!: string;

  @IsString()
  @MinLength(1)
  firstName!: string;

  @IsString()
  @MinLength(1)
  lastName!: string;

  @IsOptional()
  @IsEmail()
  personalEmail?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsDateString()
  dateOfJoining?: string;

  @IsOptional()
  @IsUUID()
  reportingManagerId?: string;

  // Optional: also provision a login user for this employee.
  @IsOptional()
  @IsEmail()
  loginEmail?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  loginTempPassword?: string;

  @IsOptional()
  @IsIn(['COMPANY_ADMIN', 'HR_MANAGER', 'LINE_MANAGER', 'EMPLOYEE', 'AUDITOR'])
  loginRole?: string;
}

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsEmail()
  personalEmail?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsUUID()
  reportingManagerId?: string;

  // Identity & personal extras (module 03 §4.2).
  @IsOptional()
  @IsString()
  maritalStatus?: string;

  @IsOptional()
  @IsString()
  bloodGroup?: string;

  @IsOptional()
  @IsString()
  nationality?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  // Employment extras.
  @IsOptional()
  @IsIn(EMPLOYMENT_TYPES)
  employmentType?: string;

  @IsOptional()
  @IsString()
  workLocation?: string;

  // Compensation-adjacent — a headline reference figure; the salary
  // *structure* lives in Payroll (module 07), not here.
  @IsOptional()
  @IsNumber()
  @Min(0)
  ctcAnnual?: number;

  @IsOptional()
  @IsString()
  payGrade?: string;

  @IsOptional()
  @IsString()
  costCenter?: string;
}

// Statutory + bank fields are a dedicated endpoint, not the general PATCH,
// because PAN/bank account need KMS field encryption (CLAUDE.md) on write —
// the general update path never touches ciphertext.
export class UpdateSensitiveFieldsDto {
  @IsOptional()
  @Matches(PAN_PATTERN, { message: 'pan must match AAAAA9999A' })
  pan?: string;

  @IsOptional()
  @Matches(AADHAAR_LAST4_PATTERN, { message: 'aadhaarLast4 must be exactly 4 digits' })
  aadhaarLast4?: string;

  @IsOptional()
  @IsString()
  uan?: string;

  @IsOptional()
  @IsString()
  pfNumber?: string;

  @IsOptional()
  @IsString()
  esicNumber?: string;

  @IsOptional()
  @IsIn(TAX_REGIMES)
  taxRegime?: string;

  @IsOptional()
  @IsString()
  bankAccountHolderName?: string;

  @IsOptional()
  @IsString()
  @MinLength(9)
  bankAccountNumber?: string;

  @IsOptional()
  @Matches(IFSC_PATTERN, { message: 'ifsc must match AAAA0999999' })
  bankIfsc?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  bankBranch?: string;

  @IsOptional()
  @IsIn(BANK_ACCOUNT_TYPES)
  bankAccountType?: string;
}

export class RevealFieldDto {
  @IsIn(['pan', 'bankAccountNumber'])
  field!: 'pan' | 'bankAccountNumber';

  @IsString()
  @MinLength(1)
  reason!: string;
}

export class UpsertEmergencyContactDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  relationship!: string;

  @IsString()
  @MinLength(1)
  phone!: string;

  @IsOptional()
  @IsString()
  altPhone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

// Lifecycle transitions are a dedicated endpoint, not a field on the general
// PATCH — module 03 RULE-4: every transition is validated against the state
// machine and requires its mandatory date + a reason (module 03 §4.4).
export class TransitionLifecycleDto {
  @IsIn(LIFECYCLE_STATES)
  targetState!: (typeof LIFECYCLE_STATES)[number];

  // Maps onto whichever date field the target state requires
  // (confirmationDate / noticeStartDate / lastWorkingDate) — see §4.4.
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @IsString()
  @MinLength(1)
  reason!: string;
}

export class CreateDepartmentDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsUUID()
  headEmployeeId?: string;
}

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsUUID()
  headEmployeeId?: string;
}

export class DeleteDepartmentDto {
  // Required only when the department still has employees — the reassign
  // guard (module 03 RULE-6).
  @IsOptional()
  @IsUUID()
  reassignToDepartmentId?: string;
}

export class SetDocumentCategoryDto {
  @IsIn(DOCUMENT_CATEGORIES)
  category!: (typeof DOCUMENT_CATEGORIES)[number];
}

export class BulkImportRowResult {
  @Type(() => Number)
  row!: number;

  @IsBoolean()
  success!: boolean;

  @IsOptional()
  @IsString()
  error?: string;
}
