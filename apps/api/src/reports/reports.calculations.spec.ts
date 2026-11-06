import {
  computeAttrition,
  computeHeadcount,
  computeMovement,
  EmployeeSnapshot,
  monthBuckets,
  parseIsoDay,
  resolvePeriod,
} from './reports.calculations';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function emp(overrides: Partial<EmployeeSnapshot>): EmployeeSnapshot {
  return {
    departmentName: 'Engineering',
    employmentType: 'FULL_TIME',
    dateOfJoining: day('2024-01-01'),
    lastWorkingDate: null,
    separationReason: null,
    ...overrides,
  };
}

describe('report calculations', () => {
  describe('parseIsoDay / resolvePeriod', () => {
    it('rejects malformed and impossible dates', () => {
      expect(parseIsoDay('2026-02-30')).toBeNull();
      expect(parseIsoDay('2026/02/01')).toBeNull();
      expect(parseIsoDay('2026-02-01')).toEqual(day('2026-02-01'));
    });

    it('defaults to 12 whole months ending in the current month', () => {
      const period = resolvePeriod({}, day('2026-10-05'));
      expect(period.from).toEqual(day('2025-11-01'));
      expect(period.to).toEqual(day('2026-10-05'));
      expect(period.months).toBe(12);
    });

    it('rejects from after to', () => {
      expect(() =>
        resolvePeriod({ from: '2026-05-01', to: '2026-04-01' }, day('2026-10-05')),
      ).toThrow('from must be on or before to');
    });

    it('rejects ranges longer than 60 months', () => {
      expect(() =>
        resolvePeriod({ from: '2019-01-01', to: '2026-01-01' }, day('2026-10-05')),
      ).toThrow('Range may not exceed 60 months');
    });
  });

  describe('monthBuckets', () => {
    it('clips the first and last months to the requested window', () => {
      const buckets = monthBuckets(day('2026-01-15'), day('2026-03-10'));
      expect(buckets.map((b) => b.key)).toEqual(['2026-01', '2026-02', '2026-03']);
      expect(buckets[0].start).toEqual(day('2026-01-15'));
      expect(buckets[0].openingInstant.toISOString()).toBe('2026-01-14T23:59:59.999Z');
      expect(buckets[2].end.toISOString()).toBe('2026-03-10T23:59:59.999Z');
    });
  });

  describe('computeHeadcount', () => {
    it('counts only employees who have joined and not yet left at the as-of date', () => {
      const employees = [
        emp({}),
        emp({ departmentName: 'Sales' }),
        emp({ dateOfJoining: day('2026-12-01') }), // not yet joined
        emp({ lastWorkingDate: day('2026-03-31') }), // left before the as-of date
        emp({ lastWorkingDate: day('2026-10-05') }), // last working day is the as-of day: gone by end of day
        emp({ dateOfJoining: null }),
      ];
      const { summary, table } = computeHeadcount(employees, day('2026-10-05'));
      expect(summary.headcount).toBe(2);
      expect(summary.missingJoiningDate).toBe(1);
      expect(table.rows.map((r) => r.department)).toEqual(['Engineering', 'Sales']);
      expect(table.rows[0].headcount).toBe(1);
    });

    it('groups people with no department under "Unassigned" and no type under UNSPECIFIED', () => {
      const { summary } = computeHeadcount(
        [emp({ departmentName: null, employmentType: null })],
        day('2026-10-05'),
      );
      expect(summary.byDepartment).toEqual([{ name: 'Unassigned', count: 1 }]);
      expect(summary.byEmploymentType).toEqual([{ type: 'UNSPECIFIED', count: 1 }]);
    });

    it('reports zero share rather than dividing by zero on an empty tenant', () => {
      const { summary, table } = computeHeadcount([], day('2026-10-05'));
      expect(summary.headcount).toBe(0);
      expect(table.rows).toEqual([]);
    });
  });

  describe('computeMovement', () => {
    it('reconciles opening + joiners - leavers to closing every month', () => {
      const employees = [
        emp({ dateOfJoining: day('2025-12-20') }), // opening member
        emp({ dateOfJoining: day('2026-01-10') }), // joins in Jan
        emp({ dateOfJoining: day('2026-01-20'), lastWorkingDate: day('2026-01-25') }), // joins and leaves in Jan
        emp({ dateOfJoining: day('2025-06-01'), lastWorkingDate: day('2026-02-14') }), // leaves in Feb
      ];
      const { summary, table } = computeMovement(employees, day('2026-01-01'), day('2026-02-28'));
      const [jan, feb] = table.rows;
      expect(jan).toMatchObject({ opening: 2, joiners: 2, leavers: 1, closing: 3 });
      expect(feb).toMatchObject({ opening: 3, joiners: 0, leavers: 1, closing: 2 });
      expect(jan.opening + jan.joiners - jan.leavers).toBe(jan.closing);
      expect(feb.opening + feb.joiners - feb.leavers).toBe(feb.closing);
      expect(summary).toMatchObject({
        openingHeadcount: 2,
        closingHeadcount: 2,
        joiners: 2,
        leavers: 2,
        netChange: 0,
      });
    });
  });

  describe('computeAttrition', () => {
    it('splits leavers by separation reason and keeps unset reasons as unspecified', () => {
      const employees = [
        emp({
          dateOfJoining: day('2024-01-01'),
          lastWorkingDate: day('2026-02-10'),
          separationReason: 'VOLUNTARY',
        }),
        emp({
          dateOfJoining: day('2024-01-01'),
          lastWorkingDate: day('2026-02-20'),
          separationReason: 'INVOLUNTARY',
        }),
        emp({ dateOfJoining: day('2024-01-01'), lastWorkingDate: day('2026-02-25') }),
        emp({ dateOfJoining: day('2024-01-01') }),
      ];
      const { summary, table } = computeAttrition(employees, day('2026-02-01'), day('2026-02-28'));
      expect(summary).toMatchObject({
        leavers: 3,
        voluntary: 1,
        involuntary: 1,
        other: 0,
        unspecified: 1,
        closingHeadcount: 1,
      });
      expect(table.rows[0]).toMatchObject({ leavers: 3, monthlyRatePct: expect.any(Number) });
    });

    it('computes tenure from joining to leaving, in months', () => {
      const employees = [
        emp({ dateOfJoining: day('2025-01-01'), lastWorkingDate: day('2025-07-02') }), // ~18 months
      ];
      const { summary } = computeAttrition(employees, day('2025-07-01'), day('2025-07-31'));
      expect(summary.avgLeaverTenureMonths).toBeCloseTo(6, 0);
      expect(summary.avgActiveTenureMonths).toBeNull();
    });

    it('returns a zero rate, not NaN, when nobody was employed in the window', () => {
      const { summary } = computeAttrition([], day('2026-01-01'), day('2026-01-31'));
      expect(summary.periodRatePct).toBe(0);
      expect(summary.annualisedRatePct).toBe(0);
      expect(Number.isNaN(summary.periodRatePct)).toBe(false);
    });
  });
});
