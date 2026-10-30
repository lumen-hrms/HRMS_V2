import { AdminInsightsService } from './admin-insights.service';

function build(over: Record<string, any> = {}) {
  const client: any = {
    employee: { findMany: jest.fn().mockResolvedValue([]) },
    leaveRequest: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'l1',
          endDate: new Date('2026-11-02T00:00:00Z'),
          halfDay: false,
          employee: { id: 'e1', firstName: 'Priya', lastName: 'Das' },
          leaveType: { name: 'Casual Leave' },
        },
      ]),
    },
    attendanceRecord: {
      groupBy: jest.fn().mockResolvedValue([
        { status: 'PRESENT', _count: { _all: 10 } },
        { status: 'LATE', _count: { _all: 2 } },
        { status: 'ON_LEAVE', _count: { _all: 1 } },
      ]),
    },
    regularizationRequest: { count: jest.fn().mockResolvedValue(3) },
    holiday: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { date: new Date('2026-11-08T00:00:00Z'), name: 'Diwali', isOptional: false },
        ]),
    },
    payrollRun: {
      findFirst: jest.fn().mockResolvedValue({ period: '2026-09', status: 'DISBURSED' }),
    },
    ...over,
  };
  return { service: new AdminInsightsService({ client } as any), client };
}

const pending = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    employee: { firstName: 'A', lastName: String(i) },
    leaveType: { name: 'Sick Leave' },
    days: '1',
    startDate: '2026-11-01',
    endDate: '2026-11-01',
    secret: 'never sent',
  }));

describe('AdminInsightsService', () => {
  it('reports who is on leave today, attendance counts, regularizations, holidays and payroll', async () => {
    const { service } = build();

    const r: any = await service.build({ pendingApprovals: [], attendance: true, payroll: true });

    expect(r.onLeaveToday).toEqual({
      total: 1,
      people: [
        {
          id: 'e1',
          name: 'Priya Das',
          leaveType: 'Casual Leave',
          halfDay: false,
          until: '2026-11-02',
        },
      ],
    });
    expect(r.attendanceToday).toEqual({ present: 12, late: 2, onLeave: 1, absent: 0 });
    expect(r.pendingRegularizations).toBe(3);
    expect(r.upcomingHolidays).toEqual([{ date: '2026-11-08', name: 'Diwali', isOptional: false }]);
    expect(r.latestPayroll).toEqual({ period: '2026-09', status: 'DISBURSED' });
  });

  it('never queries attendance or payroll when the plan does not include them', async () => {
    const { service, client } = build();

    const r: any = await service.build({ pendingApprovals: [], attendance: false, payroll: false });

    expect(client.attendanceRecord.groupBy).not.toHaveBeenCalled();
    expect(client.regularizationRequest.count).not.toHaveBeenCalled();
    expect(client.payrollRun.findFirst).not.toHaveBeenCalled();
    expect(r.attendanceToday).toBeNull();
    expect(r.pendingRegularizations).toBeNull();
    expect(r.latestPayroll).toBeNull();
  });

  it('passes through at most five pending approvals, with only the fields the dashboard shows', async () => {
    const { service } = build();

    const r: any = await service.build({
      pendingApprovals: pending(8),
      attendance: false,
      payroll: false,
    });

    expect(r.pendingApprovals).toHaveLength(5);
    expect(r.pendingApprovals[0]).toEqual({
      id: 'r0',
      employee: { firstName: 'A', lastName: '0' },
      leaveType: { name: 'Sick Leave' },
      days: '1',
      startDate: '2026-11-01',
      endDate: '2026-11-01',
    });
  });

  it('only asks for approved leave that overlaps today', async () => {
    const { service, client } = build();

    await service.build({ pendingApprovals: [], attendance: false, payroll: false });

    const where = client.leaveRequest.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('APPROVED');
    expect(where.startDate.lte).toBeInstanceOf(Date);
    expect(where.endDate.gte).toBeInstanceOf(Date);
  });
});
