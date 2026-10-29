import type { LeaveType } from '@/lib/leave/types';

/**
 * Ready-made event-based leave types — mirrors `EVENT_LEAVE_PRESETS` in
 * apps/api/src/leave/event-leave.ts. Maternity and its edge cases follow the
 * Maternity Benefit Act, 1961 (as amended 2017); paternity and marriage are
 * company policy. Every value stays editable.
 */
export type EventPreset = Pick<
  LeaveType,
  | 'name'
  | 'code'
  | 'genderRestriction'
  | 'daysPerEvent'
  | 'reducedDaysPerEvent'
  | 'reducedAfterEvents'
  | 'countCalendarDays'
  | 'maxEventsPerEmployment'
  | 'eventLabel'
  | 'eventWindowDaysBefore'
  | 'eventWindowDaysAfter'
  | 'minServiceDays'
  | 'requiresDocument'
  | 'statutoryMaternity'
> & { summary: string };

export const EVENT_PRESETS: EventPreset[] = [
  {
    name: 'Maternity Leave', code: 'ML', genderRestriction: 'FEMALE', daysPerEvent: 182,
    reducedDaysPerEvent: 84, reducedAfterEvents: 2, countCalendarDays: true, maxEventsPerEmployment: null,
    eventLabel: 'Expected delivery date', eventWindowDaysBefore: 56, eventWindowDaysAfter: 30,
    minServiceDays: 80, requiresDocument: true, statutoryMaternity: true,
    summary: '26 weeks (12 from the third child), up to 8 weeks before delivery, 80 days’ service',
  },
  {
    name: 'Adoption Leave', code: 'AL', genderRestriction: 'FEMALE', daysPerEvent: 84,
    reducedDaysPerEvent: null, reducedAfterEvents: null, countCalendarDays: true, maxEventsPerEmployment: null,
    eventLabel: 'Date the child was handed over', eventWindowDaysBefore: 0, eventWindowDaysAfter: 30,
    minServiceDays: 80, requiresDocument: true, statutoryMaternity: true,
    summary: '12 weeks for adopting a child under 3 months',
  },
  {
    name: 'Commissioning Mother Leave', code: 'CML', genderRestriction: 'FEMALE', daysPerEvent: 84,
    reducedDaysPerEvent: null, reducedAfterEvents: null, countCalendarDays: true, maxEventsPerEmployment: null,
    eventLabel: 'Date the child was handed over', eventWindowDaysBefore: 0, eventWindowDaysAfter: 30,
    minServiceDays: 80, requiresDocument: true, statutoryMaternity: true,
    summary: '12 weeks for a mother through surrogacy',
  },
  {
    name: 'Miscarriage Leave', code: 'MCL', genderRestriction: 'FEMALE', daysPerEvent: 42,
    reducedDaysPerEvent: null, reducedAfterEvents: null, countCalendarDays: true, maxEventsPerEmployment: null,
    eventLabel: 'Date of miscarriage', eventWindowDaysBefore: 0, eventWindowDaysAfter: 7,
    minServiceDays: 0, requiresDocument: true, statutoryMaternity: true,
    summary: '6 weeks, starting right after',
  },
  {
    name: 'Paternity Leave', code: 'PL', genderRestriction: 'MALE', daysPerEvent: 5,
    reducedDaysPerEvent: null, reducedAfterEvents: null, countCalendarDays: false, maxEventsPerEmployment: 2,
    eventLabel: "Child's date of birth", eventWindowDaysBefore: 0, eventWindowDaysAfter: 90,
    minServiceDays: 0, requiresDocument: false, statutoryMaternity: false,
    summary: '5 working days within 90 days of the birth, for 2 children',
  },
  {
    name: 'Marriage Leave', code: 'MRL', genderRestriction: 'ANY', daysPerEvent: 7,
    reducedDaysPerEvent: null, reducedAfterEvents: null, countCalendarDays: false, maxEventsPerEmployment: 1,
    eventLabel: 'Marriage date', eventWindowDaysBefore: 15, eventWindowDaysAfter: 30,
    minServiceDays: 0, requiresDocument: false, statutoryMaternity: false,
    summary: '7 working days, once, from 15 days before to 30 days after the wedding',
  },
];

/** One-line description of an event-based type's rules. */
export function describeEventType(t: Partial<LeaveType>): string {
  const unit = t.countCalendarDays ? 'calendar days' : 'working days';
  const parts = [`${t.daysPerEvent ?? 0} ${unit} per event`];
  if (t.reducedDaysPerEvent != null && t.reducedAfterEvents != null) {
    parts.push(`${t.reducedDaysPerEvent} after ${t.reducedAfterEvents} events`);
  }
  parts.push(t.maxEventsPerEmployment ? `max ${t.maxEventsPerEmployment}` : 'no limit');
  return parts.join(' · ');
}
