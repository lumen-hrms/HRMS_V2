import { shiftHours, validateConfig, type ConfigValidationContext } from './setup-validation';
import { validDraft } from './setup.test-fixtures';
import type { SetupDraft } from './setup.types';

const ctx = (overrides: Partial<ConfigValidationContext> = {}): ConfigValidationContext => ({
  today: new Date('2026-10-20T10:00:00Z'),
  lockedMonths: new Set(),
  otherEmployeeCodes: new Set(),
  hasExistingBalances: false,
  savedFyStartMonth: 4,
  ...overrides,
});

const errors = (draft: SetupDraft, c = ctx()) =>
  validateConfig(draft, c).filter((i) => i.level === 'error');
const warnings = (draft: SetupDraft, c = ctx()) =>
  validateConfig(draft, c).filter((i) => i.level === 'warning');

describe('validateConfig', () => {
  it('passes a complete draft with no errors', () => {
    expect(errors(validDraft())).toEqual([]);
  });

  describe('company + go-live', () => {
    it('reports company profile problems on the company step', () => {
      const draft = validDraft({ company: { ...validDraft().company, pincode: '12' } });
      expect(errors(draft)).toEqual([
        expect.objectContaining({ step: 'company', field: 'pincode' }),
      ]);
    });

    it('requires a go-live date no more than 90 days ahead', () => {
      expect(errors(validDraft({ goLiveDate: '' }))[0]).toMatchObject({ field: 'goLiveDate' });
      expect(errors(validDraft({ goLiveDate: '2027-02-01' }))[0]).toMatchObject({
        field: 'goLiveDate',
        message: expect.stringMatching(/90 days/),
      });
    });

    it('warns about a go-live before the current leave year or near its end', () => {
      expect(warnings(validDraft({ goLiveDate: '2026-02-01' }))).toContainEqual(
        expect.objectContaining({
          field: 'goLiveDate',
          message: expect.stringMatching(/full entitlement/),
        }),
      );
      const nearEnd = ctx({ today: new Date('2027-03-10T00:00:00Z') });
      expect(warnings(validDraft({ goLiveDate: '2027-03-15' }), nearEnd)).toContainEqual(
        expect.objectContaining({
          message: expect.stringMatching(/30 days of the leave-year end/),
        }),
      );
    });
  });

  describe('your profile', () => {
    it('needs a code that no other employee uses and a department from the list', () => {
      const draft = validDraft({ profile: { ...validDraft().profile, departmentName: 'Sales' } });
      const found = errors(draft, ctx({ otherEmployeeCodes: new Set(['ACME-001']) }));
      expect(found.map((i) => i.field)).toEqual(['employeeCode', 'departmentName']);
    });

    it('rejects a future joining date for the admin themselves', () => {
      const draft = validDraft({
        profile: { ...validDraft().profile, dateOfJoining: '2026-12-01' },
      });
      expect(errors(draft)).toEqual([expect.objectContaining({ field: 'dateOfJoining' })]);
    });

    it('skips the profile with only a warning when the admin is not an employee', () => {
      const draft = validDraft({
        profile: { ...validDraft().profile, notAnEmployee: true, employeeCode: '' },
      });
      expect(errors(draft)).toEqual([]);
      expect(warnings(draft)).toContainEqual(expect.objectContaining({ step: 'profile' }));
    });
  });

  it('needs at least one department, with unique names', () => {
    expect(errors(validDraft({ departments: [] }))).toContainEqual(
      expect.objectContaining({ step: 'departments' }),
    );
    const dupes = validDraft({ departments: [{ name: 'Leadership' }, { name: 'leadership ' }] });
    expect(errors(dupes)).toContainEqual(
      expect.objectContaining({ message: expect.stringMatching(/twice/) }),
    );
  });

  describe('work week + shifts', () => {
    const shift = validDraft().shifts[0];

    it('rejects a week with no working day and an invalid time zone', () => {
      const draft = validDraft({
        workWeek: { timezone: 'Mars/Olympus', weeklyOffDays: [0, 1, 2, 3, 4, 5, 6] },
      });
      expect(errors(draft).map((i) => i.field)).toEqual(['timezone', 'weeklyOffDays']);
    });

    it('needs exactly one default shift', () => {
      const two = validDraft({ shifts: [shift, { ...shift, name: 'Night' }] });
      expect(errors(two)).toContainEqual(
        expect.objectContaining({ message: expect.stringMatching(/exactly one/) }),
      );
    });

    it('checks hours against the shift length, allowing overnight shifts', () => {
      const night = { ...shift, startTime: '22:00', endTime: '06:00', minHoursFullDay: 8 };
      expect(errors(validDraft({ shifts: [night] }))).toEqual([]);
      const tooLong = { ...shift, minHoursFullDay: 10 };
      expect(errors(validDraft({ shifts: [tooLong] }))[0].message).toMatch(/longer than the shift/);
      const badHalf = { ...shift, minHoursHalfDay: 8 };
      expect(errors(validDraft({ shifts: [badHalf] }))[0].field).toBe('shifts[0].minHoursHalfDay');
    });

    it('requires core hours for a flexi shift', () => {
      const flexi = { ...shift, type: 'FLEXI' as const };
      expect(errors(validDraft({ shifts: [flexi] }))[0].field).toBe('shifts[0].coreStartTime');
    });
  });

  it('range-checks attendance rules', () => {
    const draft = validDraft({
      attendance: { ...validDraft().attendance, payrollCutoffDay: 31, captureMethods: [] },
    });
    expect(errors(draft).map((i) => i.field)).toEqual(['captureMethods', 'payrollCutoffDay']);
  });

  describe('holidays', () => {
    it('applies the holiday rules with the draft’s own leave year and weekly offs', () => {
      const draft = validDraft({
        holidays: [
          ...validDraft().holidays,
          { date: '2026-03-01', name: 'Last year', optional: false },
        ],
      });
      expect(errors(draft)).toEqual([
        expect.objectContaining({
          step: 'holidays',
          message: expect.stringMatching(/outside leave years/),
        }),
      ]);
    });

    it('ignores an already-saved holiday from an older year', () => {
      const draft = validDraft({
        holidays: [
          ...validDraft().holidays,
          { existingId: 'h-old', date: '2026-03-01', name: 'Old', optional: false },
        ],
      });
      expect(errors(draft)).toEqual([]);
    });

    it('blocks a new holiday in a month whose payroll is processed', () => {
      expect(errors(validDraft(), ctx({ lockedMonths: new Set(['2026-10']) }))).toEqual([
        expect.objectContaining({
          step: 'holidays',
          message: expect.stringMatching(/already processed/),
        }),
      ]);
    });
  });

  describe('leave policy', () => {
    const types = validDraft().leavePolicy.types;

    it('needs at least one non-comp-off type, unique codes, and sane numbers', () => {
      const draft = validDraft({
        leavePolicy: {
          ...validDraft().leavePolicy,
          types: [
            { ...types[0], code: 'CL' },
            { ...types[1], code: 'cl', annualQuota: 400 },
          ],
        },
      });
      expect(errors(draft).map((i) => i.field)).toEqual(['types[1].code', 'types[1].annualQuota']);
      const onlyCompOff = validDraft({
        leavePolicy: { ...validDraft().leavePolicy, types: [{ ...types[0], isCompOff: true }] },
      });
      expect(errors(onlyCompOff)).toContainEqual(
        expect.objectContaining({ message: 'Add at least one leave type' }),
      );
    });

    it('passes the suggested maternity/paternity/marriage presets and catches a broken event type', () => {
      expect(types.filter((t) => t.grantMode === 'ON_EVENT').map((t) => t.code)).toEqual([
        'ML',
        'AL',
        'CML',
        'MCL',
        'PL',
        'MRL',
      ]);
      const broken = validDraft({
        leavePolicy: {
          ...validDraft().leavePolicy,
          types: [types[0], { ...types.find((t) => t.code === 'MRL')!, daysPerEvent: 0 }],
        },
      });
      expect(errors(broken)).toEqual([
        expect.objectContaining({
          field: 'types[1].daysPerEvent',
          message: expect.stringMatching(/more than 0/),
        }),
      ]);
    });

    it('warns when optional holidays exist but no Restricted Holiday type does', () => {
      const draft = validDraft({
        leavePolicy: {
          ...validDraft().leavePolicy,
          types: types.filter((t) => !t.isRestrictedHoliday),
        },
      });
      expect(warnings(draft)).toContainEqual(
        expect.objectContaining({
          message: expect.stringMatching(/nobody will be able to take them/),
        }),
      );
    });

    it('warns (not errors) when changing the leave year of a tenant with balances', () => {
      const draft = validDraft({ leavePolicy: { ...validDraft().leavePolicy, fyStartMonth: 1 } });
      const c = ctx({ hasExistingBalances: true, savedFyStartMonth: 4 });
      expect(warnings(draft, c)).toContainEqual(expect.objectContaining({ field: 'fyStartMonth' }));
    });
  });
});

describe('shiftHours', () => {
  it('handles day and overnight shifts', () => {
    expect(shiftHours('09:00', '18:00')).toBe(9);
    expect(shiftHours('22:00', '06:30')).toBe(8.5);
  });
});
