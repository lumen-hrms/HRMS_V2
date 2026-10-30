import {
  computeWorkforceInsights,
  nextOccurrence,
  type InsightEmployee,
} from './admin-insights.calc';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const TODAY = d('2026-10-30');

let n = 0;
const emp = (over: Partial<InsightEmployee> = {}): InsightEmployee => ({
  id: `e${++n}`,
  firstName: `First${n}`,
  lastName: `Last${n}`,
  designation: null,
  departmentId: 'dept-a',
  department: { name: 'Aero' },
  dateOfBirth: null,
  dateOfJoining: d('2025-01-15'),
  lifecycleState: 'CONFIRMED',
  lastWorkingDate: null,
  ...over,
});

describe('nextOccurrence', () => {
  it('is today when the date falls today, later this year, or next year if already past', () => {
    expect(nextOccurrence(d('1990-10-30'), TODAY)).toEqual(d('2026-10-30'));
    expect(nextOccurrence(d('1990-12-02'), TODAY)).toEqual(d('2026-12-02'));
    expect(nextOccurrence(d('1990-03-04'), TODAY)).toEqual(d('2027-03-04'));
  });

  it('moves 29 Feb to 28 Feb in a year that has no 29th', () => {
    expect(nextOccurrence(d('1992-02-29'), TODAY)).toEqual(d('2027-02-28'));
    expect(nextOccurrence(d('1992-02-29'), d('2027-12-01'))).toEqual(d('2028-02-29'));
  });
});

describe('computeWorkforceInsights', () => {
  it('counts only working people as headcount, and splits everyone by status', () => {
    const r = computeWorkforceInsights(
      [
        emp({ lifecycleState: 'CONFIRMED' }),
        emp({ lifecycleState: 'PROBATION' }),
        emp({ lifecycleState: 'NOTICE_PERIOD' }),
        emp({ lifecycleState: 'PRE_JOINING', dateOfJoining: d('2026-11-10') }),
        emp({ lifecycleState: 'SEPARATED', lastWorkingDate: d('2026-09-01') }),
      ],
      TODAY,
    );

    expect(r.activeHeadcount).toBe(3);
    expect(r.status).toEqual({
      probation: 1,
      confirmed: 1,
      noticePeriod: 1,
      suspended: 0,
      preJoining: 1,
      separated: 1,
    });
    expect(r.joiningSoon).toBe(1);
  });

  it('groups active people by department, biggest first, leaving out the unassigned', () => {
    const r = computeWorkforceInsights(
      [
        emp({ departmentId: 'a', department: { name: 'Aero' } }),
        emp({ departmentId: 'b', department: { name: 'Legal' } }),
        emp({ departmentId: 'b', department: { name: 'Legal' } }),
        emp({ departmentId: null, department: null }),
        emp({ departmentId: 'a', department: { name: 'Aero' }, lifecycleState: 'SEPARATED' }),
      ],
      TODAY,
    );

    expect(r.departments).toEqual([
      { id: 'b', name: 'Legal', count: 2 },
      { id: 'a', name: 'Aero', count: 1 },
    ]);
    expect(r.needsAttention.noDepartment).toBe(1);
  });

  it('builds a six-month headcount trend that follows joiners and leavers', () => {
    const r = computeWorkforceInsights(
      [
        emp({ dateOfJoining: d('2026-01-10') }),
        emp({ dateOfJoining: d('2026-08-20') }),
        emp({ dateOfJoining: d('2026-10-05') }),
        // left mid-September: counted through August, not from September on
        emp({
          dateOfJoining: d('2025-06-01'),
          lifecycleState: 'SEPARATED',
          lastWorkingDate: d('2026-09-15'),
        }),
        // joins next month: not counted yet
        emp({ dateOfJoining: d('2026-11-15'), lifecycleState: 'PRE_JOINING' }),
      ],
      TODAY,
    );

    expect(r.headcountTrend.map((m) => m.month)).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(r.headcountTrend.map((m) => m.count)).toEqual([2, 2, 2, 3, 2, 3]);
  });

  it('lists joiners from the last 30 days, newest first', () => {
    const r = computeWorkforceInsights(
      [
        emp({ dateOfJoining: d('2026-10-02'), firstName: 'Old' }),
        emp({ dateOfJoining: d('2026-10-25'), firstName: 'New' }),
        emp({ dateOfJoining: d('2026-08-01'), firstName: 'Earlier' }),
      ],
      TODAY,
    );

    expect(r.joinedLast30Days).toBe(2);
    expect(r.recentJoiners.map((p) => p.name.split(' ')[0])).toEqual(['New', 'Old']);
  });

  it('finds birthdays and work anniversaries in the next 30 days, soonest first', () => {
    const r = computeWorkforceInsights(
      [
        emp({ firstName: 'Today', dateOfBirth: d('1990-10-30'), dateOfJoining: d('2020-10-30') }),
        emp({ firstName: 'Soon', dateOfBirth: d('1985-11-12'), dateOfJoining: d('2024-11-20') }),
        emp({ firstName: 'Far', dateOfBirth: d('1985-03-01'), dateOfJoining: d('2023-03-01') }),
        emp({ firstName: 'NewHire', dateOfBirth: null, dateOfJoining: d('2026-11-05') }),
        emp({ firstName: 'Gone', dateOfBirth: d('1990-10-31'), lifecycleState: 'SEPARATED' }),
      ],
      TODAY,
    );

    expect(r.upcomingBirthdays.map((p) => [p.name.split(' ')[0], p.daysUntil])).toEqual([
      ['Today', 0],
      ['Soon', 13],
    ]);
    expect(r.upcomingAnniversaries.map((p) => [p.name.split(' ')[0], p.years])).toEqual([
      ['Today', 6],
      ['Soon', 2],
    ]);
  });

  it('lists people on notice by last working day, and flags gaps in the data', () => {
    const r = computeWorkforceInsights(
      [
        emp({
          firstName: 'Late',
          lifecycleState: 'NOTICE_PERIOD',
          lastWorkingDate: d('2026-12-01'),
        }),
        emp({
          firstName: 'Soon',
          lifecycleState: 'NOTICE_PERIOD',
          lastWorkingDate: d('2026-11-05'),
        }),
        emp({ firstName: 'Undated', lifecycleState: 'NOTICE_PERIOD', lastWorkingDate: null }),
        emp({ dateOfJoining: null }),
      ],
      TODAY,
    );

    expect(r.exiting.map((p) => p.name.split(' ')[0])).toEqual(['Soon', 'Late', 'Undated']);
    expect(r.exiting[2].lastWorkingDate).toBeNull();
    expect(r.needsAttention.noJoiningDate).toBe(1);
  });
});
