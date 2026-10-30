import type { CompanyProfileInput } from '../tenant-config/company-profile';
import { EVENT_LEAVE_PRESETS } from '../leave/event-leave';

/**
 * Company setup draft (docs/TENANT_CONFIGURATION.md "Company setup"). Saved
 * whole, encrypted, in `tenant_setups.draft_ciphertext` and applied in one
 * transaction on submit. Rows that already exist in the tenant (a returning
 * tenant going through setup) carry `existingId`: they're shown and may be
 * edited where noted, but setup never deletes anything.
 */

export const SETUP_STEPS = [
  'company',
  'departments',
  'profile',
  'workWeek',
  'attendance',
  'holidays',
  'leavePolicy',
  'employees',
  'balances',
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export interface SetupIssue {
  step: SetupStep;
  level: 'error' | 'warning';
  /** Field the issue is about, for inline display (e.g. `pincode`, `shifts[1].startTime`). */
  field?: string;
  /** Spreadsheet row, for issues from an uploaded file. */
  row?: number;
  message: string;
}

export interface DraftDepartment {
  existingId?: string;
  name: string;
  code?: string;
}

export interface DraftShift {
  existingId?: string;
  name: string;
  type: 'FIXED' | 'FLEXI' | 'ROTATIONAL';
  startTime: string;
  endTime: string;
  graceMinutes: number;
  minHoursFullDay: number;
  minHoursHalfDay: number;
  coreStartTime?: string;
  coreEndTime?: string;
  isDefault: boolean;
}

export interface DraftHoliday {
  /** Already saved: shown read-only, managed in Leave › Holidays after setup. */
  existingId?: string;
  date: string;
  name: string;
  optional: boolean;
}

export interface DraftLeaveType {
  existingId?: string;
  name: string;
  code: string;
  colorToken: string;
  annualQuota: number;
  carryForwardCap: number;
  minNoticeDays: number;
  accrualFrequency: 'ANNUAL' | 'MONTHLY' | 'QUARTERLY';
  genderRestriction: 'ANY' | 'MALE' | 'FEMALE';
  paid: boolean;
  requiresApproval: boolean;
  isCompOff: boolean;
  isRestrictedHoliday: boolean;
  /** Event-based leave (maternity, paternity, marriage…) — see leave/event-leave.ts. Default ACCRUED. */
  grantMode?: 'ACCRUED' | 'ON_EVENT';
  daysPerEvent?: number | null;
  reducedDaysPerEvent?: number | null;
  reducedAfterEvents?: number | null;
  countCalendarDays?: boolean;
  maxEventsPerEmployment?: number | null;
  eventLabel?: string | null;
  eventWindowDaysBefore?: number;
  eventWindowDaysAfter?: number;
  minServiceDays?: number;
  requiresDocument?: boolean;
  statutoryMaternity?: boolean;
}

/** An uploaded file's rows, kept server-side only — never sent back to the browser. */
export interface DraftFile {
  fileName: string;
  uploadedAt: string;
  headers: string[];
  rows: { row: number; values: Record<string, string> }[];
}

export interface DraftProfile {
  /** A Company Admin who isn't on the company's rolls (e.g. an outside consultant). */
  notAnEmployee: boolean;
  /** Set by the server to whoever last edited this step; submit refuses if someone else submits. */
  forUserId?: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  designation: string;
  departmentName: string;
  dateOfJoining: string;
  gender: string;
  workState: string;
  phone: string;
}

export interface SetupDraft {
  version: 1;
  /** When the company starts running HR on Lumen (YYYY-MM-DD). */
  goLiveDate: string;
  company: CompanyProfileInput;
  profile: DraftProfile;
  departments: DraftDepartment[];
  workWeek: { timezone: string; weeklyOffDays: number[] };
  shifts: DraftShift[];
  attendance: {
    mode: 'SELF_SERVICE' | 'ROSTER' | 'OFF';
    captureMethods: ('WEB' | 'BIOMETRIC' | 'GPS' | 'IMPORT' | 'MANUAL')[];
    regularizationWindowDays: number;
    regularizationMonthlyCap: number;
    unactionedBehavior: 'AUTO_APPROVE' | 'AUTO_REJECT';
    payrollCutoffDay: number;
  };
  holidays: DraftHoliday[];
  leavePolicy: {
    fyStartMonth: number;
    leaveApprovalLevels: 1 | 2;
    /** Who decides at one level. Optional: drafts saved before it existed mean HR. */
    leaveSingleApprover?: 'HR' | 'MANAGER';
    leaveEscalationDays: number;
    allowLopRequests: boolean;
    types: DraftLeaveType[];
  };
  employeeFile: DraftFile | null;
  openingBalanceFile: DraftFile | null;
}

/** Suggested starting policy for a tenant with no leave types yet — every value is editable. */
export const SUGGESTED_LEAVE_TYPES: DraftLeaveType[] = [
  {
    name: 'Casual Leave',
    code: 'CL',
    colorToken: '#2b5a8c',
    annualQuota: 8,
    carryForwardCap: 0,
    minNoticeDays: 1,
    accrualFrequency: 'ANNUAL',
    genderRestriction: 'ANY',
    paid: true,
    requiresApproval: true,
    isCompOff: false,
    isRestrictedHoliday: false,
  },
  {
    name: 'Sick Leave',
    code: 'SL',
    colorToken: '#b3452f',
    annualQuota: 8,
    carryForwardCap: 0,
    minNoticeDays: 0,
    accrualFrequency: 'ANNUAL',
    genderRestriction: 'ANY',
    paid: true,
    requiresApproval: true,
    isCompOff: false,
    isRestrictedHoliday: false,
  },
  {
    name: 'Earned Leave',
    code: 'EL',
    colorToken: '#2f7d4f',
    annualQuota: 15,
    carryForwardCap: 30,
    minNoticeDays: 7,
    accrualFrequency: 'MONTHLY',
    genderRestriction: 'ANY',
    paid: true,
    requiresApproval: true,
    isCompOff: false,
    isRestrictedHoliday: false,
  },
  {
    name: 'Restricted Holiday',
    code: 'RH',
    colorToken: '#8a5a1f',
    annualQuota: 2,
    carryForwardCap: 0,
    minNoticeDays: 1,
    accrualFrequency: 'ANNUAL',
    genderRestriction: 'ANY',
    paid: true,
    requiresApproval: true,
    isCompOff: false,
    isRestrictedHoliday: true,
  },
  // Event-based leave — no yearly balance; each request names its event.
  ...Object.values(EVENT_LEAVE_PRESETS).map((p): DraftLeaveType => ({
    ...p,
    colorToken: '#7a4f9a',
    annualQuota: 0,
    carryForwardCap: 0,
    minNoticeDays: 0,
    accrualFrequency: 'ANNUAL',
    paid: true,
    requiresApproval: true,
    isCompOff: false,
    isRestrictedHoliday: false,
    grantMode: 'ON_EVENT',
  })),
];
