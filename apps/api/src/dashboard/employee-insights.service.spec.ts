import { EmployeeInsightsService } from './employee-insights.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const user = {
  sub: 'u-me',
  tenantId: 'tenant-1',
  role: 'EMPLOYEE',
  email: 'me@test.com',
  employeeId: 'me',
} as AuthenticatedUser;

const person = (id: string, reportingManagerId: string | null = null) => ({
  id,
  firstName: id,
  lastName: 'Test',
  designation: 'Engineer',
  reportingManagerId,
  lifecycleState: 'CONFIRMED',
  dateOfJoining: d('2020-01-01'),
});

function build(overrides: { people?: any[]; leaves?: any[]; holidays?: any[] } = {}) {
  const client = {
    employee: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          overrides.people ?? [person('vp'), person('me', 'vp'), person('peer', 'vp'), person('x')],
        ),
    },
    holiday: { findMany: jest.fn().mockResolvedValue(overrides.holidays ?? []) },
    leaveRequest: { findMany: jest.fn().mockResolvedValue(overrides.leaves ?? []) },
  };
  const attendance = {
    stats: jest.fn().mockResolvedValue({
      daysPresent: 12,
      workingDays: 15,
      punctualityRate: 92,
      remainingLeave: 9,
      leaveBreakdown: [],
      overtimeHours: 3.5,
      targetHours: 8,
      daily: [{ date: '2026-10-05', status: 'PRESENT', workedMinutes: 480 }],
    }),
  };
  const service = new EmployeeInsightsService({ client } as any, attendance as any);
  return { service, client, attendance };
}

describe('EmployeeInsightsService.build', () => {
  it('summarises this month’s attendance when the plan has Attendance', async () => {
    const { service, attendance } = build();

    const result = await service.build(user, { attendance: true, leave: true });

    expect(attendance.stats).toHaveBeenCalledWith(user, expect.stringMatching(/^\d{4}-\d{2}$/));
    expect(result.monthAttendance).toEqual({
      daysPresent: 12,
      workingDays: 15,
      punctualityRate: 92,
      overtimeHours: 3.5,
      targetHours: 8,
      daily: [{ date: '2026-10-05', status: 'PRESENT', workedMinutes: 480 }],
    });
  });

  it('skips attendance when the plan lacks it or the user has no employee record', async () => {
    const off = build();
    const noPlan = await off.service.build(user, { attendance: false, leave: true });
    expect(off.attendance.stats).not.toHaveBeenCalled();
    expect(noPlan.monthAttendance).toBeNull();

    const unlinked = build();
    const noEmployee = await unlinked.service.build(
      { ...user, employeeId: null },
      { attendance: true, leave: true },
    );
    expect(unlinked.attendance.stats).not.toHaveBeenCalled();
    expect(noEmployee.monthAttendance).toBeNull();
    expect(noEmployee.myTeam).toBeNull();
  });

  it('reports the manager and team size', async () => {
    const { service } = build();

    const { myTeam } = await service.build(user, { attendance: false, leave: true });

    expect(myTeam).toMatchObject({
      manager: { id: 'vp' },
      teammateCount: 1,
      reportCount: 0,
    });
  });

  it('asks for approved leave of the team members only — never of anyone else', async () => {
    const { service, client } = build({
      leaves: [
        {
          employeeId: 'peer',
          startDate: d('2026-10-31'),
          endDate: d('2026-11-02'),
          halfDay: false,
        },
      ],
    });

    const { teamOnLeave } = await service.build(user, { attendance: false, leave: true });

    const where = client.leaveRequest.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('APPROVED');
    expect(where.employeeId.in.sort()).toEqual(['peer', 'vp']);
    expect(teamOnLeave).toEqual([
      expect.objectContaining({ id: 'peer', relation: 'TEAMMATE', onLeaveToday: true }),
    ]);
  });

  it('does not query leave when the plan has no Leave module or the team is empty', async () => {
    const noModule = build();
    await noModule.service.build(user, { attendance: false, leave: false });
    expect(noModule.client.leaveRequest.findMany).not.toHaveBeenCalled();

    const alone = build({ people: [person('me')] });
    const result = await alone.service.build(user, { attendance: false, leave: true });
    expect(alone.client.leaveRequest.findMany).not.toHaveBeenCalled();
    expect(result.teamOnLeave).toEqual([]);
  });

  it('lists upcoming holidays with how many days away they are', async () => {
    const future = new Date(Date.now() + 3 * 86_400_000);
    const { service } = build({
      holidays: [
        {
          id: 'h1',
          name: 'Diwali',
          date: new Date(
            Date.UTC(future.getUTCFullYear(), future.getUTCMonth(), future.getUTCDate()),
          ),
          isOptional: false,
        },
      ],
    });

    const { upcomingHolidays } = await service.build(user, { attendance: false, leave: false });

    expect(upcomingHolidays).toEqual([
      expect.objectContaining({ name: 'Diwali', isOptional: false, daysUntil: 3 }),
    ]);
  });
});
