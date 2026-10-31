import {
  buildMyTeam,
  computeCelebrations,
  shapeTeamOnLeave,
  type TeamPerson,
} from './employee-insights.calc';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const TODAY = d('2026-10-31');

let n = 0;
function person(over: Partial<TeamPerson> & { id: string }): TeamPerson {
  n++;
  return {
    firstName: over.id,
    lastName: 'Test',
    designation: `Role ${n}`,
    reportingManagerId: null,
    lifecycleState: 'CONFIRMED',
    dateOfJoining: d('2020-01-01'),
    ...over,
  };
}

describe('buildMyTeam', () => {
  const people = [
    person({ id: 'vp' }),
    person({ id: 'me', reportingManagerId: 'vp' }),
    person({ id: 'peer', reportingManagerId: 'vp' }),
    person({ id: 'gone-peer', reportingManagerId: 'vp', lifecycleState: 'SEPARATED' }),
    person({ id: 'soon-peer', reportingManagerId: 'vp', lifecycleState: 'PRE_JOINING' }),
    person({ id: 'r1', reportingManagerId: 'me' }),
    person({ id: 'r1a', reportingManagerId: 'r1' }),
    person({ id: 'stranger' }),
  ];

  it('returns the manager and counts teammates and direct + indirect reports', () => {
    const team = buildMyTeam(people, 'me');

    expect(team.manager).toMatchObject({ id: 'vp', name: 'vp Test' });
    expect(team.teammateCount).toBe(1);
    expect(team.reportCount).toBe(2);
  });

  it('leaves out people who have left or not joined yet, and strangers', () => {
    const ids = buildMyTeam(people, 'me').members.map((m) => m.id);

    expect(ids.sort()).toEqual(['peer', 'r1', 'r1a', 'vp']);
  });

  it('labels each member with how they relate to the caller', () => {
    const rel = Object.fromEntries(
      buildMyTeam(people, 'me').members.map((m) => [m.id, m.relation]),
    );

    expect(rel).toEqual({ vp: 'BOSS', peer: 'TEAMMATE', r1: 'REPORT', r1a: 'REPORT' });
  });

  it('has no manager for the top of the tree', () => {
    expect(buildMyTeam(people, 'vp').manager).toBeNull();
  });
});

describe('computeCelebrations', () => {
  it('lists people who joined in the last 30 days, newest first', () => {
    const { newJoiners } = computeCelebrations(
      [
        person({ id: 'old', dateOfJoining: d('2026-08-01') }),
        person({ id: 'a', dateOfJoining: d('2026-10-05') }),
        person({ id: 'b', dateOfJoining: d('2026-10-20') }),
        person({ id: 'future', dateOfJoining: d('2026-11-15'), lifecycleState: 'PRE_JOINING' }),
      ],
      TODAY,
    );

    expect(newJoiners.map((j) => j.id)).toEqual(['b', 'a']);
    expect(newJoiners[0]).toMatchObject({ date: '2026-10-20', name: 'b Test' });
  });

  it('lists anniversaries in the next 30 days with the number of years, soonest first', () => {
    const { anniversaries } = computeCelebrations(
      [
        person({ id: 'later', dateOfJoining: d('2021-11-20') }),
        person({ id: 'today', dateOfJoining: d('2019-10-31') }),
        person({ id: 'far', dateOfJoining: d('2018-06-01') }),
      ],
      TODAY,
    );

    expect(anniversaries.map((a) => [a.id, a.years, a.daysUntil])).toEqual([
      ['today', 7, 0],
      ['later', 5, 20],
    ]);
  });

  it('does not celebrate a first day as an anniversary, nor people who have left', () => {
    const { anniversaries } = computeCelebrations(
      [
        person({ id: 'new', dateOfJoining: d('2026-11-10') }),
        person({ id: 'gone', dateOfJoining: d('2020-11-05'), lifecycleState: 'SEPARATED' }),
      ],
      TODAY,
    );

    expect(anniversaries).toEqual([]);
  });

  it('exposes only name, role and dates — nothing personal', () => {
    const { anniversaries } = computeCelebrations(
      [person({ id: 'x', dateOfJoining: d('2020-11-02') })],
      TODAY,
    );

    expect(Object.keys(anniversaries[0]).sort()).toEqual(
      ['date', 'daysUntil', 'designation', 'id', 'name', 'years'].sort(),
    );
  });
});

describe('shapeTeamOnLeave', () => {
  const members = [
    { id: 'vp', name: 'Vee Pee', relation: 'BOSS' as const },
    { id: 'peer', name: 'Pat Peer', relation: 'TEAMMATE' as const },
  ];

  it('keeps only team members, flags who is away today, and sorts by start date', () => {
    const rows = shapeTeamOnLeave(
      [
        {
          employeeId: 'peer',
          startDate: d('2026-11-03'),
          endDate: d('2026-11-04'),
          halfDay: false,
        },
        { employeeId: 'vp', startDate: d('2026-10-30'), endDate: d('2026-11-01'), halfDay: false },
        {
          employeeId: 'stranger',
          startDate: d('2026-10-31'),
          endDate: d('2026-10-31'),
          halfDay: false,
        },
      ],
      members,
      TODAY,
    );

    expect(rows.map((r) => [r.id, r.onLeaveToday])).toEqual([
      ['vp', true],
      ['peer', false],
    ]);
    expect(rows[0]).toMatchObject({ relation: 'BOSS', from: '2026-10-30', to: '2026-11-01' });
  });

  it('never exposes the leave type or reason', () => {
    const [row] = shapeTeamOnLeave(
      [
        {
          employeeId: 'peer',
          startDate: d('2026-10-31'),
          endDate: d('2026-10-31'),
          halfDay: true,
          leaveType: 'Sick leave',
          reason: 'Surgery',
        } as any,
      ],
      members,
      TODAY,
    );

    expect(Object.keys(row).sort()).toEqual(
      ['from', 'halfDay', 'id', 'name', 'onLeaveToday', 'relation', 'to'].sort(),
    );
  });
});
