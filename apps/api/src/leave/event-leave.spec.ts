import {
  EVENT_LEAVE_PRESETS,
  calendarDays,
  eventAllowance,
  eventRequestProblem,
  eventTypeConfigProblems,
  serviceDaysBefore,
  type EventLeavePolicy,
  type EventRequestInput,
} from './event-leave';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const policy = (preset: keyof typeof EVENT_LEAVE_PRESETS): EventLeavePolicy => ({
  ...EVENT_LEAVE_PRESETS[preset],
});

function request(
  p: EventLeavePolicy,
  overrides: Partial<EventRequestInput> = {},
): EventRequestInput {
  return {
    policy: p,
    gender: p.genderRestriction === 'MALE' ? 'Male' : 'Female',
    dateOfJoining: d('2020-01-01'),
    eventDate: d('2026-12-01'),
    startDate: d('2026-12-01'),
    days: 5,
    halfDay: false,
    activeEventDates: [],
    daysAlreadyForEvent: 0,
    ...overrides,
  };
}

describe('event-based leave', () => {
  describe('maternity (statutory)', () => {
    const ml = policy('MATERNITY');

    it('allows 182 calendar days starting up to 8 weeks before the delivery date', () => {
      expect(
        eventRequestProblem(request(ml, { startDate: d('2026-10-06'), days: 182 })),
      ).toBeNull();
      expect(eventRequestProblem(request(ml, { startDate: d('2026-10-05'), days: 100 }))).toMatch(
        /at most 56 days before/,
      );
    });

    it('drops to 84 days from the third child', () => {
      expect(eventAllowance(ml, 0)).toBe(182);
      expect(eventAllowance(ml, 1)).toBe(182);
      expect(eventAllowance(ml, 2)).toBe(84);
      const third = request(ml, { days: 100, activeEventDates: ['2021-05-01', '2023-08-01'] });
      expect(eventRequestProblem(third)).toMatch(/84 calendar days for this event/);
    });

    it('lets one event be split into pre- and post-delivery requests up to the allowance', () => {
      const second = request(ml, {
        days: 100,
        activeEventDates: ['2026-12-01'],
        daysAlreadyForEvent: 82,
      });
      expect(eventRequestProblem(second)).toBeNull();
      expect(eventRequestProblem({ ...second, days: 101 })).toMatch(/Only 100 of this event's 182/);
    });

    it('needs 80 days of service in the 12 months before the delivery date', () => {
      const newJoiner = request(ml, { dateOfJoining: d('2026-10-01') }); // 61 days
      expect(eventRequestProblem(newJoiner)).toMatch(/needs 80 days of service.*you'll have 61/);
      expect(eventRequestProblem(request(ml, { dateOfJoining: null }))).toMatch(/needs 80 days/);
    });

    it('fails closed on gender: blank refuses, male refuses', () => {
      expect(eventRequestProblem(request(ml, { gender: null }))).toMatch(
        /ask HR to add your gender/,
      );
      expect(eventRequestProblem(request(ml, { gender: 'male' }))).toMatch(/female employees only/);
    });

    it('needs the delivery date and is never a half day', () => {
      expect(eventRequestProblem(request(ml, { eventDate: null }))).toMatch(
        /expected delivery date/,
      );
      expect(eventRequestProblem(request(ml, { halfDay: true, days: 0.5 }))).toMatch(/half day/);
    });
  });

  it('adoption and commissioning mother are 84 days from the hand-over, miscarriage 42', () => {
    expect(eventAllowance(policy('ADOPTION'), 0)).toBe(84);
    expect(eventAllowance(policy('COMMISSIONING_MOTHER'), 3)).toBe(84);
    const mc = policy('MISCARRIAGE');
    expect(eventAllowance(mc, 0)).toBe(42);
    // Starts right after the miscarriage — at most a week later, never before it.
    expect(eventRequestProblem(request(mc, { startDate: d('2026-12-09'), days: 42 }))).toMatch(
      /within 7 days/,
    );
    expect(eventRequestProblem(request(mc, { startDate: d('2026-11-30'), days: 42 }))).toMatch(
      /at most 0 days before/,
    );
    // No service requirement for miscarriage leave.
    expect(
      eventRequestProblem(request(mc, { dateOfJoining: d('2026-11-20'), days: 42 })),
    ).toBeNull();
  });

  describe('paternity (company policy)', () => {
    const pl = policy('PATERNITY');

    it('is 5 working days within 90 days of the birth, for men only', () => {
      expect(eventRequestProblem(request(pl, { startDate: d('2027-02-20') }))).toBeNull();
      expect(eventRequestProblem(request(pl, { startDate: d('2027-03-02') }))).toMatch(
        /within 90 days/,
      );
      expect(eventRequestProblem(request(pl, { days: 6 }))).toMatch(/5 working days/);
      expect(eventRequestProblem(request(pl, { gender: 'Female' }))).toMatch(/male employees only/);
    });

    it('can be used for two children, then not again — but twins are one event', () => {
      const twoUsed = request(pl, { activeEventDates: ['2022-01-01', '2024-01-01'] });
      expect(eventRequestProblem(twoUsed)).toMatch(/2 times during your employment/);
      const sameBirth = request(pl, {
        activeEventDates: ['2022-01-01', '2026-12-01'],
        daysAlreadyForEvent: 2,
        days: 3,
      });
      expect(eventRequestProblem(sameBirth)).toBeNull();
    });
  });

  describe('marriage (company policy)', () => {
    const mrl = policy('MARRIAGE');

    it('is 7 working days, once per employment, around the marriage date', () => {
      expect(eventRequestProblem(request(mrl, { days: 7, startDate: d('2026-11-20') }))).toBeNull();
      expect(eventRequestProblem(request(mrl, { days: 8 }))).toMatch(/7 working days/);
      expect(eventRequestProblem(request(mrl, { activeEventDates: ['2024-02-14'] }))).toMatch(
        /once/,
      );
      expect(eventRequestProblem(request(mrl, { startDate: d('2026-11-15') }))).toMatch(
        /at most 15 days before/,
      );
    });

    it('is open to everyone, whatever the profile says about gender', () => {
      expect(eventRequestProblem(request(mrl, { gender: null }))).toBeNull();
    });
  });

  it('counts service in the 12 months before the event only', () => {
    expect(serviceDaysBefore(d('2015-01-01'), d('2026-12-01'))).toBe(365);
    expect(serviceDaysBefore(d('2026-11-01'), d('2026-12-01'))).toBe(30);
    expect(calendarDays(d('2026-12-01'), d('2026-12-07'))).toBe(7);
  });

  it('checks an event type’s own settings', () => {
    expect(eventTypeConfigProblems({ grantMode: 'ACCRUED' })).toEqual([]);
    expect(
      eventTypeConfigProblems({ ...EVENT_LEAVE_PRESETS.MATERNITY, grantMode: 'ON_EVENT' }),
    ).toEqual([]);
    expect(
      eventTypeConfigProblems({
        grantMode: 'ON_EVENT',
        daysPerEvent: 0,
        reducedDaysPerEvent: 200,
        eventLabel: '',
        isCompOff: true,
      }),
    ).toEqual([
      'Days per event must be more than 0',
      'Set both the reduced days and after how many events they apply, or neither',
      'Reduced days can’t be more than the normal days per event',
      'Name the event the employee enters, e.g. "Marriage date"',
      'An event-based type can’t also be comp-off or restricted holiday',
    ]);
  });
});
