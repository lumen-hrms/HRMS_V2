import { phoneError } from '@/lib/phone';
import type { SetupDraft, SetupStepId } from '@/lib/setup';

/**
 * Instant, in-browser mirror of the field-level rules in
 * `apps/api/src/setup/setup-validation.ts` (+ `company-profile.ts`). The server
 * stays authoritative — it re-checks everything on save/submit and also owns the
 * rules that need other data (duplicate employee codes, holiday dates…). Keep the
 * wording identical so a message doesn't change when the server answers.
 */
export interface LocalIssue {
  message: string;
  /** "Is required" style — shown only once the user has tried to continue. */
  required?: boolean;
}
export type LocalErrors = Partial<Record<SetupStepId, Record<string, LocalIssue>>>;

const PINCODE = /^[1-9]\d{5}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CIN = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
const CITY = /^\p{L}[\p{L} .'’-]{1,79}$/u;
const EMPLOYEE_CODE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,19}$/;
const PERSON_NAME = /^\p{L}[\p{L} .'’-]{0,49}$/u;
const DEPARTMENT_CODE = /^[A-Za-z0-9_-]{1,10}$/;
const LEAVE_CODE = /^[A-Z0-9_]{1,10}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_GO_LIVE_AHEAD_DAYS = 90;

const nameMessage = (which: string) => `${which} name must be up to 50 letters (spaces, . ’ - allowed)`;

export function localSetupErrors(draft: SetupDraft, today = new Date()): LocalErrors {
  const out: LocalErrors = {};
  const put = (step: SetupStepId, field: string, message: string, required = false) => {
    const bucket = (out[step] ??= {});
    bucket[field] ??= { message, required }; // first problem per field wins
  };
  const len = (v: string | null | undefined) => (v ?? '').trim().length;

  // ---- 1. Company ----
  const c = draft.company ?? {};
  const co = (field: string, message: string, required = false) => put('company', field, message, required);
  if (!len(c.legalName)) co('legalName', 'Legal name is required', true);
  else if (len(c.legalName) < 2 || len(c.legalName) > 150) co('legalName', 'Legal name must be 2–150 characters');
  if (!len(c.addressLine1)) co('addressLine1', 'Address is required', true);
  else if (len(c.addressLine1) > 200) co('addressLine1', 'Address can be at most 200 characters');
  if (len(c.addressLine2) > 200) co('addressLine2', 'Address line 2 can be at most 200 characters');
  if (!len(c.city)) co('city', 'City is required', true);
  else if (!CITY.test(c.city!.trim())) co('city', 'City must be 2–80 letters (spaces, . ’ - allowed)');
  if (!len(c.state)) co('state', 'State is required', true);
  if (!len(c.pincode)) co('pincode', 'PIN code is required', true);
  else if (!PINCODE.test(c.pincode!.trim())) co('pincode', 'PIN code must be 6 digits');
  if (!len(c.contactEmail)) co('contactEmail', 'Contact email is required', true);
  else if (!EMAIL.test(c.contactEmail!.trim())) co('contactEmail', 'Enter a valid email address');
  else if (len(c.contactEmail) > 254) co('contactEmail', 'Email can be at most 254 characters');
  if (!len(c.contactPhone)) co('contactPhone', 'Contact phone is required', true);
  else {
    const m = phoneError(c.contactPhone!);
    if (m) co('contactPhone', m);
  }
  if (!len(c.gstin)) co('gstin', 'GSTIN is required', true);
  else if (!GSTIN.test(c.gstin!.trim().toUpperCase())) co('gstin', 'GSTIN must be 15 characters, e.g. 27AAPFU0939F1ZV');
  if (len(c.cin) && !CIN.test(c.cin!.trim().toUpperCase())) {
    co('cin', 'CIN must be 21 characters, e.g. U72200MH2009PTC123456');
  }
  if (!draft.goLiveDate) co('goLiveDate', 'Go-live date is required', true);
  else {
    const d = new Date(draft.goLiveDate + 'T00:00:00Z');
    const todayUtc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    if (Number.isNaN(d.getTime())) co('goLiveDate', 'Go-live date is required', true);
    else if (d < new Date('2000-01-01T00:00:00Z')) co('goLiveDate', 'Go-live date looks wrong — check the year');
    else if ((d.getTime() - todayUtc.getTime()) / 86_400_000 > MAX_GO_LIVE_AHEAD_DAYS) {
      co('goLiveDate', `Go-live can be at most ${MAX_GO_LIVE_AHEAD_DAYS} days from today`);
    }
  }

  // ---- 2. Departments ----
  const seenNames = new Set<string>();
  const seenCodes = new Set<string>();
  (draft.departments ?? []).forEach((d, i) => {
    const pd = (field: string, message: string, required = false) =>
      put('departments', `departments[${i}].${field}`, message, required);
    const name = d.name?.trim();
    if (!name) pd('name', 'Department name is required', true);
    else {
      if (name.length > 100) pd('name', 'Department name can be at most 100 characters');
      if (seenNames.has(name.toLowerCase())) pd('name', `"${name}" is listed twice`);
      seenNames.add(name.toLowerCase());
    }
    const code = d.code?.trim();
    if (code) {
      if (!DEPARTMENT_CODE.test(code)) pd('code', 'Department code can use letters, digits, _ and - only (up to 10)');
      else if (seenCodes.has(code.toUpperCase())) pd('code', `Code ${code} is used twice`);
      seenCodes.add(code.toUpperCase());
    }
  });

  // ---- 3. Profile ----
  const p = draft.profile;
  if (p && !p.notAnEmployee) {
    const pr = (field: string, message: string, required = false) => put('profile', field, message, required);
    if (!p.employeeCode?.trim()) pr('employeeCode', 'Employee code is required', true);
    else if (!EMPLOYEE_CODE.test(p.employeeCode.trim())) {
      pr('employeeCode', 'Employee code can use letters, digits and . _ / - only (up to 20 characters)');
    }
    if (!p.firstName?.trim()) pr('firstName', 'First name is required', true);
    else if (!PERSON_NAME.test(p.firstName.trim())) pr('firstName', nameMessage('First'));
    if (!p.lastName?.trim()) pr('lastName', 'Last name is required', true);
    else if (!PERSON_NAME.test(p.lastName.trim())) pr('lastName', nameMessage('Last'));
    if ((p.designation ?? '').trim().length > 100) pr('designation', 'Designation can be at most 100 characters');
    if (!p.departmentName?.trim()) pr('departmentName', 'Department is required', true);
    if (p.gender && !['Male', 'Female', 'Other'].includes(p.gender)) pr('gender', 'Pick a gender from the list');
    if (!p.dateOfJoining) pr('dateOfJoining', 'Date of joining is required', true);
    else {
      const d = new Date(p.dateOfJoining + 'T00:00:00Z');
      if (Number.isNaN(d.getTime())) pr('dateOfJoining', 'Date of joining is required', true);
      else if (d.getTime() > today.getTime()) pr('dateOfJoining', 'Date of joining can’t be in the future for your own profile');
      else if (d < new Date('1950-01-01T00:00:00Z')) pr('dateOfJoining', 'Date of joining looks wrong — check the year');
    }
    if (p.phone?.trim()) {
      const m = phoneError(p.phone);
      if (m) pr('phone', m);
    }
  }

  // ---- 4. Shifts ----
  const shiftNames = new Set<string>();
  (draft.shifts ?? []).forEach((s, i) => {
    const sh = (field: string, message: string, required = false) =>
      put('workWeek', `shifts[${i}].${field}`, message, required);
    const label = s.name?.trim() || `Shift ${i + 1}`;
    if (!s.name?.trim()) sh('name', 'Shift name is required', true);
    else if (s.name.trim().length > 60) sh('name', 'Shift name can be at most 60 characters');
    else if (shiftNames.has(s.name.trim().toLowerCase())) sh('name', `"${label}" is listed twice`);
    shiftNames.add(s.name?.trim().toLowerCase());
    if (!HHMM.test(s.startTime ?? '')) sh('startTime', `${label}: start time must be HH:MM`, !s.startTime);
    if (!HHMM.test(s.endTime ?? '')) sh('endTime', `${label}: end time must be HH:MM`, !s.endTime);
    if (!(s.graceMinutes >= 0 && s.graceMinutes <= 180)) sh('graceMinutes', `${label}: grace must be 0–180 minutes`);
    if (!(s.minHoursFullDay > 0 && s.minHoursFullDay <= 24)) {
      sh('minHoursFullDay', `${label}: full-day hours must be between 0 and 24`);
    }
    if (!(s.minHoursHalfDay > 0 && s.minHoursHalfDay < s.minHoursFullDay)) {
      sh('minHoursHalfDay', `${label}: half-day hours must be more than 0 and less than full-day hours`);
    }
    if (HHMM.test(s.startTime ?? '') && HHMM.test(s.endTime ?? '') && s.startTime === s.endTime) {
      sh('endTime', `${label}: start and end can't be the same time`);
    }
    if (s.type === 'FLEXI') {
      const startOk = HHMM.test(s.coreStartTime ?? '');
      const endOk = HHMM.test(s.coreEndTime ?? '');
      if (!startOk) sh('coreStartTime', `${label}: a flexi shift needs core start time (HH:MM)`, true);
      if (!endOk) sh('coreEndTime', `${label}: a flexi shift needs core end time (HH:MM)`, true);
      if (startOk && endOk && s.coreStartTime! >= s.coreEndTime!) {
        sh('coreEndTime', `${label}: core hours must start before they end`);
      }
    }
  });

  // ---- 5. Attendance ----
  const a = draft.attendance;
  if (a) {
    const at = (field: string, message: string) => put('attendance', field, message);
    if (!(Number.isInteger(a.regularizationWindowDays) && a.regularizationWindowDays >= 1 && a.regularizationWindowDays <= 60)) {
      at('regularizationWindowDays', 'Regularization window must be 1–60 days');
    }
    if (!(Number.isInteger(a.regularizationMonthlyCap) && a.regularizationMonthlyCap >= 1 && a.regularizationMonthlyCap <= 31)) {
      at('regularizationMonthlyCap', 'Monthly regularization cap must be 1–31');
    }
    if (!(Number.isInteger(a.payrollCutoffDay) && a.payrollCutoffDay >= 1 && a.payrollCutoffDay <= 28)) {
      at('payrollCutoffDay', 'Payroll cut-off day must be 1–28');
    }
    if (a.mode !== 'OFF' && (a.captureMethods ?? []).length === 0) {
      put('attendance', 'captureMethods', 'Pick at least one way attendance is captured', true);
    }
  }

  // ---- 6. Holidays: the add-row (date + name) is checked in the step itself ----

  // ---- 7. Leave policy ----
  const lp = draft.leavePolicy;
  if (lp) {
    if (!(Number.isInteger(lp.leaveEscalationDays) && lp.leaveEscalationDays >= 1 && lp.leaveEscalationDays <= 30)) {
      put('leavePolicy', 'leaveEscalationDays', 'Escalation must be 1–30 days');
    }
    const names = new Set<string>();
    const codes = new Set<string>();
    (lp.types ?? []).forEach((t, i) => {
      const lt = (field: string, message: string, required = false) =>
        put('leavePolicy', `types[${i}].${field}`, message, required);
      const label = t.name?.trim() || `Leave type ${i + 1}`;
      if (!t.name?.trim()) lt('name', 'Leave type name is required', true);
      else if (t.name.trim().length > 60) lt('name', 'Leave type name can be at most 60 characters');
      else if (names.has(t.name.trim().toLowerCase())) lt('name', `"${label}" is listed twice`);
      names.add(t.name?.trim().toLowerCase());
      const code = t.code?.trim().toUpperCase();
      if (!code) lt('code', `${label}: code is required`, true);
      else if (!LEAVE_CODE.test(code)) lt('code', `${label}: code must be up to 10 letters/digits`);
      else if (codes.has(code)) lt('code', `${label}: code ${code} is used twice`);
      if (code) codes.add(code);
      if (!(t.annualQuota >= 0 && t.annualQuota <= 365)) lt('annualQuota', `${label}: quota must be 0–365 days`);
      if (!(t.carryForwardCap >= 0 && t.carryForwardCap <= 365)) {
        lt('carryForwardCap', `${label}: carry-forward cap must be 0–365 days`);
      }
      if (!(Number.isInteger(t.minNoticeDays) && t.minNoticeDays >= 0 && t.minNoticeDays <= 90)) {
        lt('minNoticeDays', `${label}: notice must be 0–90 days`);
      }
    });
  }
  return out;
}

/** Same check the Holidays "Add" row uses. */
export function holidayRowErrors(row: { date: string; name: string }): { date?: string; name?: string } {
  const out: { date?: string; name?: string } = {};
  if (row.date) {
    const d = new Date(row.date + 'T00:00:00Z');
    if (Number.isNaN(d.getTime()) || d < new Date('2000-01-01T00:00:00Z')) out.date = 'Enter a valid date';
  }
  if (row.name.trim().length > 100) out.name = 'Holiday name can be at most 100 characters';
  return out;
}

/** True when a server message is an "is required / pick one" style one (hidden until the user tries to continue). */
export const isRequiredMessage = (m: string) =>
  /\brequired\b|^(Pick|Add at least|Fill in|Set your|Mark exactly)\b/.test(m);
