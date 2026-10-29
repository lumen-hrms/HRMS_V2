import { IndianState } from '@prisma/client';
import { companyProfileErrors } from '../tenant-config/company-profile';
import { holidayKey, validateHolidays } from '../leave/holiday-import';
import { leaveYearWindow, utcDay, daysBetween } from '../leave/leave-entitlement';
import { resolveLeaveYear } from '../leave/leave-year.util';
import { parseImportDate } from '../common/bulk-import';
import { eventTypeConfigProblems } from '../leave/event-leave';
import type { SetupDraft, SetupIssue, SetupStep } from './setup.types';

/**
 * Pure validation of company setup's configuration steps (everything except
 * the two uploaded files, which need the employee importer — see
 * `SetupService`). Submit is refused while any `error` remains; `warning`s
 * are shown on the step and the review screen but never block.
 */

export interface ConfigValidationContext {
  today: Date;
  /** `YYYY-MM` months with a processed/disbursed payroll run. */
  lockedMonths: Set<string>;
  /** Codes of employees already in the tenant, except the submitting admin's own. */
  otherEmployeeCodes: Set<string>;
  /** The tenant already has leave balances (a returning tenant). */
  hasExistingBalances: boolean;
  /** The leave-year start month currently saved (only meaningful with existing balances). */
  savedFyStartMonth: number;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const STATES = new Set<string>(Object.values(IndianState));
const MAX_GO_LIVE_AHEAD_DAYS = 90;

export function validateConfig(draft: SetupDraft, ctx: ConfigValidationContext): SetupIssue[] {
  const issues: SetupIssue[] = [];
  const add =
    (step: SetupStep, level: SetupIssue['level'] = 'error') =>
    (message: string, field?: string) =>
      issues.push({ step, level, message, ...(field ? { field } : {}) });

  validateCompany(draft, ctx, add);
  validateProfile(draft, ctx, add);
  validateDepartments(draft, add);
  validateWorkWeek(draft, add);
  validateAttendance(draft, add);
  validateHolidayStep(draft, ctx, issues);
  validateLeavePolicy(draft, ctx, add);
  return issues;
}

type Adder = (
  step: SetupStep,
  level?: SetupIssue['level'],
) => (message: string, field?: string) => void;

function validateCompany(draft: SetupDraft, ctx: ConfigValidationContext, add: Adder) {
  const err = add('company');
  for (const [field, message] of Object.entries(companyProfileErrors(draft.company ?? {}))) {
    err(message, field);
  }
  const goLive = draft.goLiveDate ? parseImportDate(draft.goLiveDate) : null;
  if (!goLive) {
    err('Go-live date is required', 'goLiveDate');
    return;
  }
  const today = utcDay(ctx.today);
  const goLiveDay = new Date(goLive);
  if (daysBetween(today, goLiveDay) > MAX_GO_LIVE_AHEAD_DAYS) {
    err(`Go-live can be at most ${MAX_GO_LIVE_AHEAD_DAYS} days from today`, 'goLiveDate');
  }
  const fy = draft.leavePolicy?.fyStartMonth;
  if (fy >= 1 && fy <= 12) {
    const window = leaveYearWindow(resolveLeaveYear(today, fy), fy);
    const warn = add('company', 'warning');
    if (goLiveDay < window.start) {
      warn(
        'Go-live is before the current leave year, so everyone without an opening balance gets this year’s full entitlement.',
        'goLiveDate',
      );
    } else if (daysBetween(goLiveDay, window.end) <= 30 && goLiveDay < window.end) {
      warn(
        `Go-live is within 30 days of the leave-year end (${window.end.toISOString().slice(0, 10)}). Opening balances roll into the new year through carry-forward.`,
        'goLiveDate',
      );
    }
  }
}

function validateProfile(draft: SetupDraft, ctx: ConfigValidationContext, add: Adder) {
  const p = draft.profile;
  const err = add('profile');
  if (!p) {
    err('Fill in your employee profile');
    return;
  }
  if (p.notAnEmployee) {
    add(
      'profile',
      'warning',
    )(
      'You won’t have leave, attendance or payslips of your own. You can link your login to an employee record later.',
    );
    return;
  }
  if (!p.employeeCode?.trim()) err('Employee code is required', 'employeeCode');
  else if (ctx.otherEmployeeCodes.has(p.employeeCode.trim())) {
    err(
      `Employee code ${p.employeeCode.trim()} is already used by another employee`,
      'employeeCode',
    );
  }
  if (!p.firstName?.trim()) err('First name is required', 'firstName');
  if (!p.lastName?.trim()) err('Last name is required', 'lastName');
  if (!p.dateOfJoining || !parseImportDate(p.dateOfJoining)) {
    err('Date of joining is required', 'dateOfJoining');
  } else if (new Date(parseImportDate(p.dateOfJoining)!) > utcDay(ctx.today)) {
    err('Date of joining can’t be in the future for your own profile', 'dateOfJoining');
  }
  const departments = new Set((draft.departments ?? []).map((d) => d.name.trim().toLowerCase()));
  if (!p.departmentName?.trim()) err('Department is required', 'departmentName');
  else if (!departments.has(p.departmentName.trim().toLowerCase())) {
    err(`Department "${p.departmentName}" isn't in your departments list`, 'departmentName');
  }
  if (p.workState && !STATES.has(p.workState)) err('Pick a state from the list', 'workState');
}

function validateDepartments(draft: SetupDraft, add: Adder) {
  const err = add('departments');
  const list = draft.departments ?? [];
  if (list.length === 0) err('Add at least one department');
  const seen = new Set<string>();
  list.forEach((d, i) => {
    const name = d.name?.trim();
    if (!name) {
      err('Department name is required', `departments[${i}].name`);
      return;
    }
    const k = name.toLowerCase();
    if (seen.has(k)) err(`"${name}" is listed twice`, `departments[${i}].name`);
    seen.add(k);
  });
}

function validateWorkWeek(draft: SetupDraft, add: Adder) {
  const err = add('workWeek');
  const ww = draft.workWeek;
  if (!ww?.timezone || !isValidTimezone(ww.timezone)) err('Pick a valid time zone', 'timezone');
  const offs = ww?.weeklyOffDays ?? [];
  if (
    offs.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
    new Set(offs).size !== offs.length
  ) {
    err('Weekly offs must be distinct days of the week', 'weeklyOffDays');
  }
  if (offs.length >= 7) err('At least one day of the week must be a working day', 'weeklyOffDays');
  if (offs.length === 0)
    add('workWeek', 'warning')(
      'No weekly off is set — every day is a working day.',
      'weeklyOffDays',
    );

  const shifts = draft.shifts ?? [];
  if (shifts.length === 0) err('Add at least one shift');
  const defaults = shifts.filter((s) => s.isDefault).length;
  if (shifts.length > 0 && defaults !== 1) err('Mark exactly one shift as the default');
  const names = new Set<string>();
  shifts.forEach((s, i) => {
    const f = (k: string) => `shifts[${i}].${k}`;
    const label = s.name?.trim() || `Shift ${i + 1}`;
    if (!s.name?.trim()) err('Shift name is required', f('name'));
    else if (names.has(s.name.trim().toLowerCase())) err(`"${label}" is listed twice`, f('name'));
    names.add(s.name?.trim().toLowerCase());
    if (!['FIXED', 'FLEXI', 'ROTATIONAL'].includes(s.type))
      err(`${label}: pick a shift type`, f('type'));
    if (!HHMM.test(s.startTime ?? '')) err(`${label}: start time must be HH:MM`, f('startTime'));
    if (!HHMM.test(s.endTime ?? '')) err(`${label}: end time must be HH:MM`, f('endTime'));
    if (!(s.graceMinutes >= 0 && s.graceMinutes <= 180)) {
      err(`${label}: grace must be 0–180 minutes`, f('graceMinutes'));
    }
    if (!(s.minHoursFullDay > 0 && s.minHoursFullDay <= 24)) {
      err(`${label}: full-day hours must be between 0 and 24`, f('minHoursFullDay'));
    }
    if (!(s.minHoursHalfDay > 0 && s.minHoursHalfDay < s.minHoursFullDay)) {
      err(
        `${label}: half-day hours must be more than 0 and less than full-day hours`,
        f('minHoursHalfDay'),
      );
    }
    if (HHMM.test(s.startTime ?? '') && HHMM.test(s.endTime ?? '')) {
      const length = shiftHours(s.startTime, s.endTime);
      if (length === 0) err(`${label}: start and end can't be the same time`, f('endTime'));
      else if (s.minHoursFullDay > length) {
        err(
          `${label}: full-day hours (${s.minHoursFullDay}) are longer than the shift itself (${length})`,
          f('minHoursFullDay'),
        );
      }
    }
    if (s.type === 'FLEXI') {
      if (!HHMM.test(s.coreStartTime ?? '') || !HHMM.test(s.coreEndTime ?? '')) {
        err(`${label}: a flexi shift needs core hours (HH:MM)`, f('coreStartTime'));
      }
    }
  });
}

function validateAttendance(draft: SetupDraft, add: Adder) {
  const err = add('attendance');
  const a = draft.attendance;
  if (!a) {
    err('Set your attendance rules');
    return;
  }
  if (!['SELF_SERVICE', 'ROSTER', 'OFF'].includes(a.mode)) err('Pick an attendance mode', 'mode');
  const methods = ['WEB', 'BIOMETRIC', 'GPS', 'IMPORT', 'MANUAL'];
  if (a.mode !== 'OFF' && (a.captureMethods ?? []).length === 0) {
    err('Pick at least one way attendance is captured', 'captureMethods');
  }
  if ((a.captureMethods ?? []).some((m) => !methods.includes(m))) {
    err('Unknown capture method', 'captureMethods');
  }
  if (!(
    Number.isInteger(a.regularizationWindowDays) &&
    a.regularizationWindowDays >= 1 &&
    a.regularizationWindowDays <= 60
  )) {
    err('Regularization window must be 1–60 days', 'regularizationWindowDays');
  }
  if (!(
    Number.isInteger(a.regularizationMonthlyCap) &&
    a.regularizationMonthlyCap >= 1 &&
    a.regularizationMonthlyCap <= 31
  )) {
    err('Monthly regularization cap must be 1–31', 'regularizationMonthlyCap');
  }
  if (!['AUTO_APPROVE', 'AUTO_REJECT'].includes(a.unactionedBehavior)) {
    err('Pick what happens to requests nobody acts on', 'unactionedBehavior');
  }
  if (!(
    Number.isInteger(a.payrollCutoffDay) &&
    a.payrollCutoffDay >= 1 &&
    a.payrollCutoffDay <= 28
  )) {
    err('Payroll cut-off day must be 1–28', 'payrollCutoffDay');
  }
}

function validateHolidayStep(
  draft: SetupDraft,
  ctx: ConfigValidationContext,
  issues: SetupIssue[],
) {
  const fy = draft.leavePolicy?.fyStartMonth;
  if (!(fy >= 1 && fy <= 12)) return; // reported on the leave-policy step
  const today = utcDay(ctx.today);
  const year = resolveLeaveYear(today, fy);
  const holidays = draft.holidays ?? [];
  const existingKeys = new Set(holidays.filter((h) => h.existingId).map(holidayKey));
  const found = validateHolidays(
    holidays.map((h) => ({ date: h.date, name: h.name, optional: h.optional })),
    {
      current: leaveYearWindow(year, fy),
      next: leaveYearWindow(year + 1, fy),
      weeklyOffDays: draft.workWeek?.weeklyOffDays ?? [],
      lockedMonths: ctx.lockedMonths,
      existingKeys,
    },
  );
  for (const i of found) {
    // An already-saved holiday that's now out of range (an old year) is history, not a problem.
    if (i.level === 'error' && i.date && holidays.some((h) => h.existingId && h.date === i.date)) {
      continue;
    }
    issues.push({
      step: 'holidays',
      level: i.level,
      message: i.message,
      ...(i.date ? { field: i.date } : {}),
    });
  }
  if (holidays.length === 0) {
    issues.push({
      step: 'holidays',
      level: 'warning',
      message: 'No holidays added — every non-weekly-off day will count as a working day.',
    });
  }
}

function validateLeavePolicy(draft: SetupDraft, ctx: ConfigValidationContext, add: Adder) {
  const err = add('leavePolicy');
  const warn = add('leavePolicy', 'warning');
  const lp = draft.leavePolicy;
  if (!lp) {
    err('Set your leave policy');
    return;
  }
  if (!(Number.isInteger(lp.fyStartMonth) && lp.fyStartMonth >= 1 && lp.fyStartMonth <= 12)) {
    err('Pick the month your leave year starts', 'fyStartMonth');
  } else if (ctx.hasExistingBalances && lp.fyStartMonth !== ctx.savedFyStartMonth) {
    warn(
      'Changing the leave-year start moves the boundary for balances that already exist — check them in Leave › Team Balances afterwards.',
      'fyStartMonth',
    );
  }
  if (lp.leaveApprovalLevels !== 1 && lp.leaveApprovalLevels !== 2) {
    err('Approval levels must be 1 or 2', 'leaveApprovalLevels');
  }
  if (!(
    Number.isInteger(lp.leaveEscalationDays) &&
    lp.leaveEscalationDays >= 1 &&
    lp.leaveEscalationDays <= 30
  )) {
    err('Escalation must be 1–30 days', 'leaveEscalationDays');
  }

  const types = lp.types ?? [];
  if (types.filter((t) => !t.isCompOff).length === 0) err('Add at least one leave type');
  const codes = new Set<string>();
  const names = new Set<string>();
  types.forEach((t, i) => {
    const f = (k: string) => `types[${i}].${k}`;
    const label = t.name?.trim() || `Leave type ${i + 1}`;
    if (!t.name?.trim()) err('Leave type name is required', f('name'));
    else if (names.has(t.name.trim().toLowerCase())) err(`"${label}" is listed twice`, f('name'));
    names.add(t.name?.trim().toLowerCase());
    const code = t.code?.trim().toUpperCase();
    if (!code) err(`${label}: code is required`, f('code'));
    else if (!/^[A-Z0-9_]{1,10}$/.test(code))
      err(`${label}: code must be up to 10 letters/digits`, f('code'));
    else if (codes.has(code)) err(`${label}: code ${code} is used twice`, f('code'));
    if (code) codes.add(code);
    if (!(t.annualQuota >= 0 && t.annualQuota <= 365))
      err(`${label}: quota must be 0–365 days`, f('annualQuota'));
    if (!(t.carryForwardCap >= 0 && t.carryForwardCap <= 365)) {
      err(`${label}: carry-forward cap must be 0–365 days`, f('carryForwardCap'));
    }
    if (!(Number.isInteger(t.minNoticeDays) && t.minNoticeDays >= 0 && t.minNoticeDays <= 90)) {
      err(`${label}: notice must be 0–90 days`, f('minNoticeDays'));
    }
    if (!['ANNUAL', 'MONTHLY', 'QUARTERLY'].includes(t.accrualFrequency)) {
      err(`${label}: pick how it accrues`, f('accrualFrequency'));
    }
    if (!['ANY', 'MALE', 'FEMALE'].includes(t.genderRestriction)) {
      err(`${label}: pick who can take it`, f('genderRestriction'));
    }
    if (t.isCompOff && t.isRestrictedHoliday) {
      err(`${label}: can't be both comp-off and restricted holiday`, f('isRestrictedHoliday'));
    }
    for (const problem of eventTypeConfigProblems(t))
      err(`${label}: ${problem}`, f('daysPerEvent'));
    if (!t.isCompOff && t.grantMode !== 'ON_EVENT' && t.annualQuota === 0) {
      warn(
        `${label}: quota is 0, so nobody can take it without going into loss of pay`,
        f('annualQuota'),
      );
    }
  });
  if (types.filter((t) => t.isCompOff).length > 1)
    err('Only one leave type can be the comp-off type');

  const optionalHolidays = (draft.holidays ?? []).filter((h) => h.optional).length;
  const rh = types.filter((t) => t.isRestrictedHoliday);
  if (optionalHolidays > 0 && rh.length === 0) {
    warn(
      `You have ${optionalHolidays} optional holiday${optionalHolidays === 1 ? '' : 's'} but no Restricted Holiday leave type — nobody will be able to take them.`,
    );
  }
  for (const t of rh) {
    if (t.annualQuota > optionalHolidays) {
      warn(
        `${t.name}: quota (${t.annualQuota}) is more than the ${optionalHolidays} optional holidays on your list`,
      );
    }
  }
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Shift length in hours; an end before the start is an overnight shift. */
export function shiftHours(start: string, end: string): number {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  let minutes = toMin(end) - toMin(start);
  if (minutes < 0) minutes += 24 * 60;
  return Math.round((minutes / 60) * 100) / 100;
}
