import { api } from '@/lib/api';

/**
 * Company setup (apps/api/src/setup) — types mirror `setup.types.ts`. The
 * browser only ever holds the configuration part of the draft; uploaded
 * employee / opening-balance rows stay server-side and come back as
 * summaries + validation reports.
 */

export const SETUP_STEPS = [
  { id: 'company', label: 'Company' },
  { id: 'departments', label: 'Departments' },
  { id: 'profile', label: 'Your profile' },
  { id: 'workWeek', label: 'Work week & shifts' },
  { id: 'attendance', label: 'Attendance rules' },
  { id: 'holidays', label: 'Holidays' },
  { id: 'leavePolicy', label: 'Leave policy' },
  { id: 'employees', label: 'Import employees' },
  { id: 'balances', label: 'Opening balances' },
  { id: 'review', label: 'Review & submit' },
] as const;
export type SetupStepId = (typeof SETUP_STEPS)[number]['id'];

export interface SetupIssue {
  step: Exclude<SetupStepId, 'review'>;
  level: 'error' | 'warning';
  field?: string;
  row?: number;
  message: string;
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
  /** Event-based leave (maternity, paternity, marriage…). Default ACCRUED. */
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

export interface DraftHoliday {
  existingId?: string;
  date: string;
  name: string;
  optional: boolean;
}

export interface SetupDraft {
  version: 1;
  goLiveDate: string;
  company: {
    legalName?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    pincode?: string;
    contactEmail?: string;
    contactPhone?: string;
    gstin?: string;
    cin?: string;
  };
  profile: {
    notAnEmployee: boolean;
    employeeCode: string;
    firstName: string;
    lastName: string;
    designation: string;
    departmentName: string;
    dateOfJoining: string;
    gender: string;
    workState: string;
    phone: string;
  };
  departments: { existingId?: string; name: string; code?: string }[];
  workWeek: { timezone: string; weeklyOffDays: number[] };
  shifts: DraftShift[];
  attendance: {
    mode: 'SELF_SERVICE' | 'ROSTER' | 'OFF';
    captureMethods: string[];
    regularizationWindowDays: number;
    regularizationMonthlyCap: number;
    unactionedBehavior: 'AUTO_APPROVE' | 'AUTO_REJECT';
    payrollCutoffDay: number;
  };
  holidays: DraftHoliday[];
  leavePolicy: {
    fyStartMonth: number;
    leaveApprovalLevels: 1 | 2;
    /** Who decides at one level; absent on drafts saved before it existed (= HR). */
    leaveSingleApprover?: 'HR' | 'MANAGER';
    leaveEscalationDays: number;
    allowLopRequests: boolean;
    types: DraftLeaveType[];
  };
}

export interface FileSummary {
  fileName: string;
  uploadedAt: string;
  rowCount: number;
}

export interface ImportRowResult {
  row: number;
  employeeCode: string | null;
  action: 'create' | 'update' | null;
  success: boolean;
  error?: string;
  warnings?: string[];
  detail?: string;
}

export interface ImportReport {
  totalRows: number;
  succeeded: number;
  failed: number;
  ignoredColumns: string[];
  summary: Record<string, number | string[]>;
  results: ImportRowResult[];
}

export interface SetupValidation {
  ok: boolean;
  issues: SetupIssue[];
  employeeReport: ImportReport | null;
  balanceReport: ImportReport | null;
}

export interface LoginFailure {
  employeeCode: string;
  email: string;
  role: string;
  error: string;
}

export interface SetupStatus {
  complete: boolean;
  completedAt: string | null;
  payrollConfigured: boolean;
  loginFailures: LoginFailure[];
}

export interface SubmitResult {
  complete: true;
  counts: Record<string, number>;
  loginFailures: LoginFailure[];
}

export const setupApi = {
  status: () => api.get<SetupStatus>('/setup/status'),
  draft: () =>
    api.get<{
      draft: SetupDraft;
      savedAt: string | null;
      files: { employees: FileSummary | null; balances: FileSummary | null };
    }>('/setup/draft'),
  save: (draft: SetupDraft) => api.put<{ savedAt: string }>('/setup/draft', { draft }),
  validate: () => api.post<SetupValidation>('/setup/validate'),
  uploadFile: (kind: 'employees' | 'balances', file: File) =>
    api.upload<{ file: FileSummary; report: ImportReport | null }>(`/setup/files/${kind}`, file),
  removeFile: (kind: 'employees' | 'balances') => api.delete(`/setup/files/${kind}`),
  importHolidays: (file: File) =>
    api.upload<{
      merged: boolean;
      added: number;
      updated: number;
      issues: { level: string; row?: number; message: string }[];
      holidays?: DraftHoliday[];
    }>('/setup/holidays/import', file),
  submit: () => api.post<SubmitResult>('/setup/submit'),
  retryLogins: () => api.post<{ loginFailures: LoginFailure[] }>('/setup/logins/retry'),
};

export const INDIAN_STATES = [
  'ANDHRA_PRADESH', 'ARUNACHAL_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GOA', 'GUJARAT',
  'HARYANA', 'HIMACHAL_PRADESH', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA_PRADESH',
  'MAHARASHTRA', 'MANIPUR', 'MEGHALAYA', 'MIZORAM', 'NAGALAND', 'ODISHA', 'PUNJAB', 'RAJASTHAN',
  'SIKKIM', 'TAMIL_NADU', 'TELANGANA', 'TRIPURA', 'UTTAR_PRADESH', 'UTTARAKHAND', 'WEST_BENGAL',
  'ANDAMAN_AND_NICOBAR_ISLANDS', 'CHANDIGARH', 'DADRA_AND_NAGAR_HAVELI_AND_DAMAN_AND_DIU', 'DELHI',
  'JAMMU_AND_KASHMIR', 'LADAKH', 'LAKSHADWEEP', 'PUDUCHERRY',
];

export const stateLabel = (s: string) =>
  s
    .toLowerCase()
    .split('_')
    .map((w) => (w === 'and' ? 'and' : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Opening-balance template — mirrors `OPENING_BALANCE_COLUMNS` in apps/api/src/setup/opening-balances.ts. */
export const OPENING_BALANCE_COLUMNS = [
  { name: 'employeeCode', required: true, description: 'An existing employee, a row in your employee file, or your own code.' },
  { name: 'leaveTypeCode', required: true, description: 'A leave type code from the Leave policy step, e.g. EL.' },
  {
    name: 'openingBalance',
    required: true,
    description:
      'Days available in your previous HRMS on the day before go-live (0 or more, up to 2 decimals). Leave out any credit that system already gave for the go-live month itself.',
  },
];
