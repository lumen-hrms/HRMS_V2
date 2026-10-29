/**
 * Event-based leave (module 04 §4.4b) — maternity, paternity, marriage and
 * the maternity edge cases. Pure: `LeaveService.apply()` supplies the
 * employee, the leave type and their earlier requests of that type.
 *
 * There's no yearly balance. Each request names an *event date* (expected
 * delivery, child's birth, marriage…); requests with the same event date
 * share that event's allowance, so maternity can be split into a pre- and a
 * post-delivery request. An event counts toward the type's limit once any
 * of its requests is pending or approved.
 */

export interface EventLeavePolicy {
  name: string;
  genderRestriction: 'ANY' | 'MALE' | 'FEMALE';
  daysPerEvent: number;
  reducedDaysPerEvent: number | null;
  reducedAfterEvents: number | null;
  countCalendarDays: boolean;
  maxEventsPerEmployment: number | null;
  eventLabel: string | null;
  eventWindowDaysBefore: number;
  eventWindowDaysAfter: number;
  minServiceDays: number;
}

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The allowance for the next event, given how many earlier events there were. */
export function eventAllowance(policy: EventLeavePolicy, earlierEvents: number): number {
  if (
    policy.reducedDaysPerEvent !== null &&
    policy.reducedAfterEvents !== null &&
    earlierEvents >= policy.reducedAfterEvents
  ) {
    return policy.reducedDaysPerEvent;
  }
  return policy.daysPerEvent;
}

/** Calendar days employed in the 12 months up to (not including) `eventDate`. */
export function serviceDaysBefore(dateOfJoining: Date | null, eventDate: Date): number {
  if (!dateOfJoining) return 0;
  const yearBefore = new Date(eventDate.getTime() - 365 * DAY_MS);
  const from = dateOfJoining > yearBefore ? dateOfJoining : yearBefore;
  return Math.max(0, Math.round((eventDate.getTime() - from.getTime()) / DAY_MS));
}

export interface EventRequestInput {
  policy: EventLeavePolicy;
  /** Free-text `Employee.gender`. */
  gender: string | null;
  dateOfJoining: Date | null;
  eventDate: Date | null;
  startDate: Date;
  days: number;
  halfDay: boolean;
  /** Event dates (YYYY-MM-DD) of this employee's pending/approved requests of this type. */
  activeEventDates: string[];
  /** Days already pending/approved against *this* event date. */
  daysAlreadyForEvent: number;
}

/**
 * Every rule an event-based request must pass, in the order an employee
 * would want to hear about them. Returns the first problem, or null.
 */
export function eventRequestProblem(input: EventRequestInput): string | null {
  const { policy } = input;
  const label = policy.eventLabel?.toLowerCase() ?? 'event date';
  if (!input.eventDate) return `${policy.name} needs the ${label}`;
  if (input.halfDay && policy.countCalendarDays) {
    return `${policy.name} is counted in calendar days and can't be taken as a half day`;
  }

  // Gender fails *closed* here (unlike accrued types): granting 26 weeks of
  // maternity leave on a blank profile field isn't a safe default.
  if (policy.genderRestriction !== 'ANY') {
    const g = input.gender?.trim().toUpperCase();
    if (g !== 'MALE' && g !== 'FEMALE') {
      return `${policy.name} is for ${policy.genderRestriction.toLowerCase()} employees — ask HR to add your gender to your profile`;
    }
    if (g !== policy.genderRestriction) {
      return `${policy.name} is for ${policy.genderRestriction.toLowerCase()} employees only`;
    }
  }

  const event = input.eventDate;
  const earliest = new Date(event.getTime() - policy.eventWindowDaysBefore * DAY_MS);
  const latest = new Date(event.getTime() + policy.eventWindowDaysAfter * DAY_MS);
  if (input.startDate < earliest) {
    return `${policy.name} can start at most ${policy.eventWindowDaysBefore} days before the ${label} (${iso(earliest)})`;
  }
  if (input.startDate > latest) {
    return policy.eventWindowDaysAfter === 0
      ? `${policy.name} must start on or before the ${label} (${iso(event)})`
      : `${policy.name} must start within ${policy.eventWindowDaysAfter} days of the ${label} (by ${iso(latest)})`;
  }

  const eventKey = iso(event);
  const earlierEvents = new Set(input.activeEventDates.filter((d) => d !== eventKey)).size;
  const isNewEvent = !input.activeEventDates.includes(eventKey);
  if (
    isNewEvent &&
    policy.maxEventsPerEmployment !== null &&
    earlierEvents >= policy.maxEventsPerEmployment
  ) {
    return `${policy.name} can be taken ${policy.maxEventsPerEmployment === 1 ? 'once' : `${policy.maxEventsPerEmployment} times`} during your employment, and you've used it`;
  }

  if (policy.minServiceDays > 0) {
    const served = serviceDaysBefore(input.dateOfJoining, event);
    if (served < policy.minServiceDays) {
      return `${policy.name} needs ${policy.minServiceDays} days of service in the 12 months before the ${label} — you'll have ${served}`;
    }
  }

  const allowance = eventAllowance(policy, earlierEvents);
  const left = Math.max(0, allowance - input.daysAlreadyForEvent);
  if (input.days > left) {
    const unit = policy.countCalendarDays ? 'calendar days' : 'working days';
    return input.daysAlreadyForEvent > 0
      ? `Only ${left} of this event's ${allowance} ${unit} are left — this request is ${input.days}`
      : `${policy.name} is ${allowance} ${unit} for this event — this request is ${input.days}`;
  }
  return null;
}

/** Problems with an event-based leave type's own settings (create/update, company setup). */
export function eventTypeConfigProblems(t: {
  grantMode?: string;
  daysPerEvent?: number | null;
  reducedDaysPerEvent?: number | null;
  reducedAfterEvents?: number | null;
  eventLabel?: string | null;
  eventWindowDaysBefore?: number;
  eventWindowDaysAfter?: number;
  isCompOff?: boolean;
  isRestrictedHoliday?: boolean;
}): string[] {
  if (t.grantMode !== 'ON_EVENT') return [];
  const problems: string[] = [];
  if (!(Number(t.daysPerEvent) > 0)) problems.push('Days per event must be more than 0');
  const hasReduced = t.reducedDaysPerEvent !== null && t.reducedDaysPerEvent !== undefined;
  const hasAfter = t.reducedAfterEvents !== null && t.reducedAfterEvents !== undefined;
  if (hasReduced !== hasAfter) {
    problems.push('Set both the reduced days and after how many events they apply, or neither');
  }
  if (hasReduced && Number(t.reducedDaysPerEvent) > Number(t.daysPerEvent)) {
    problems.push('Reduced days can’t be more than the normal days per event');
  }
  if (!t.eventLabel?.trim())
    problems.push('Name the event the employee enters, e.g. "Marriage date"');
  if ((t.eventWindowDaysBefore ?? 0) > 365 || (t.eventWindowDaysAfter ?? 0) > 365) {
    problems.push('The window around the event can be at most 365 days');
  }
  if (t.isCompOff || t.isRestrictedHoliday) {
    problems.push('An event-based type can’t also be comp-off or restricted holiday');
  }
  return problems;
}

/** Inclusive calendar days between two dates. */
export function calendarDays(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

/** A leave type row → policy, or null when it isn't event-based. */
export function toEventPolicy(t: {
  name: string;
  grantMode: string;
  genderRestriction: string;
  daysPerEvent: unknown;
  reducedDaysPerEvent: unknown;
  reducedAfterEvents: number | null;
  countCalendarDays: boolean;
  maxEventsPerEmployment: number | null;
  eventLabel: string | null;
  eventWindowDaysBefore: number;
  eventWindowDaysAfter: number;
  minServiceDays: number;
}): EventLeavePolicy | null {
  if (t.grantMode !== 'ON_EVENT') return null;
  return {
    name: t.name,
    genderRestriction: t.genderRestriction as EventLeavePolicy['genderRestriction'],
    daysPerEvent: Number(t.daysPerEvent ?? 0),
    reducedDaysPerEvent:
      t.reducedDaysPerEvent === null || t.reducedDaysPerEvent === undefined
        ? null
        : Number(t.reducedDaysPerEvent),
    reducedAfterEvents: t.reducedAfterEvents,
    countCalendarDays: t.countCalendarDays,
    maxEventsPerEmployment: t.maxEventsPerEmployment,
    eventLabel: t.eventLabel,
    eventWindowDaysBefore: t.eventWindowDaysBefore,
    eventWindowDaysAfter: t.eventWindowDaysAfter,
    minServiceDays: t.minServiceDays,
  };
}

/**
 * Ready-made types, offered in company setup and in Leave Types → Add.
 * Statutory values follow the Maternity Benefit Act, 1961 (as amended 2017);
 * paternity and marriage are company policy. Every value is editable.
 */
export const EVENT_LEAVE_PRESETS = {
  MATERNITY: {
    name: 'Maternity Leave',
    code: 'ML',
    genderRestriction: 'FEMALE',
    daysPerEvent: 182,
    reducedDaysPerEvent: 84,
    reducedAfterEvents: 2,
    countCalendarDays: true,
    maxEventsPerEmployment: null,
    eventLabel: 'Expected delivery date',
    eventWindowDaysBefore: 56,
    eventWindowDaysAfter: 30,
    minServiceDays: 80,
    requiresDocument: true,
    statutoryMaternity: true,
  },
  ADOPTION: {
    name: 'Adoption Leave',
    code: 'AL',
    genderRestriction: 'FEMALE',
    daysPerEvent: 84,
    reducedDaysPerEvent: null,
    reducedAfterEvents: null,
    countCalendarDays: true,
    maxEventsPerEmployment: null,
    eventLabel: 'Date the child was handed over',
    eventWindowDaysBefore: 0,
    eventWindowDaysAfter: 30,
    minServiceDays: 80,
    requiresDocument: true,
    statutoryMaternity: true,
  },
  COMMISSIONING_MOTHER: {
    name: 'Commissioning Mother Leave',
    code: 'CML',
    genderRestriction: 'FEMALE',
    daysPerEvent: 84,
    reducedDaysPerEvent: null,
    reducedAfterEvents: null,
    countCalendarDays: true,
    maxEventsPerEmployment: null,
    eventLabel: 'Date the child was handed over',
    eventWindowDaysBefore: 0,
    eventWindowDaysAfter: 30,
    minServiceDays: 80,
    requiresDocument: true,
    statutoryMaternity: true,
  },
  MISCARRIAGE: {
    name: 'Miscarriage Leave',
    code: 'MCL',
    genderRestriction: 'FEMALE',
    daysPerEvent: 42,
    reducedDaysPerEvent: null,
    reducedAfterEvents: null,
    countCalendarDays: true,
    maxEventsPerEmployment: null,
    eventLabel: 'Date of miscarriage',
    eventWindowDaysBefore: 0,
    eventWindowDaysAfter: 7,
    minServiceDays: 0,
    requiresDocument: true,
    statutoryMaternity: true,
  },
  PATERNITY: {
    name: 'Paternity Leave',
    code: 'PL',
    genderRestriction: 'MALE',
    daysPerEvent: 5,
    reducedDaysPerEvent: null,
    reducedAfterEvents: null,
    countCalendarDays: false,
    maxEventsPerEmployment: 2,
    eventLabel: "Child's date of birth",
    eventWindowDaysBefore: 0,
    eventWindowDaysAfter: 90,
    minServiceDays: 0,
    requiresDocument: false,
    statutoryMaternity: false,
  },
  MARRIAGE: {
    name: 'Marriage Leave',
    code: 'MRL',
    genderRestriction: 'ANY',
    daysPerEvent: 7,
    reducedDaysPerEvent: null,
    reducedAfterEvents: null,
    countCalendarDays: false,
    maxEventsPerEmployment: 1,
    eventLabel: 'Marriage date',
    eventWindowDaysBefore: 15,
    eventWindowDaysAfter: 30,
    minServiceDays: 0,
    requiresDocument: false,
    statutoryMaternity: false,
  },
} as const;
