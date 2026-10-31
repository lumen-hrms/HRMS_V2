import { DashboardController } from './dashboard.controller';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

function buildController(opts: {
  role: string;
  enabledModules: string[];
  attendanceRecord?: { status: string; checkInAt: Date | null; checkOutAt: Date | null } | null;
}) {
  const tenantPrisma: any = {
    client: {
      employee: { count: jest.fn().mockResolvedValue(7) },
      department: {
        findMany: jest.fn().mockResolvedValue([{ name: 'Engineering', _count: { employees: 7 } }]),
      },
    },
  };
  const leave: any = {
    pendingApprovals: jest.fn().mockResolvedValue([]),
    getBalances: jest.fn().mockResolvedValue([]),
    listForEmployee: jest.fn().mockResolvedValue([]),
  };
  const attendance: any = {
    today: jest.fn().mockResolvedValue({
      record: opts.attendanceRecord ?? null,
      isOnBreak: false,
      effectiveMs: 3_600_000,
      targetHours: 8,
    }),
  };
  const platformPrisma: any = {
    subscription: {
      findUnique: jest.fn().mockResolvedValue({ enabledModules: opts.enabledModules }),
    },
  };
  const insights: any = {
    build: jest.fn().mockResolvedValue({ activeHeadcount: 7 }),
    onLeaveTodayDetail: jest.fn().mockResolvedValue([{ id: 'l1' }]),
    pendingApprovalsDetail: jest.fn((rows: any[]) => rows.map((r) => ({ id: r.id }))),
  };
  const employeeInsights: any = { build: jest.fn().mockResolvedValue({ myTeam: null }) };
  const controller = new DashboardController(
    tenantPrisma,
    leave,
    attendance,
    platformPrisma,
    insights,
    employeeInsights,
  );
  return { controller, attendance, platformPrisma, insights, employeeInsights, leave };
}

describe('DashboardController', () => {
  const baseUser: AuthenticatedUser = {
    sub: 'u1',
    email: 'employee@example.com',
    tenantId: 'tenant-1',
    role: 'EMPLOYEE',
    employeeId: 'emp-1',
  } as AuthenticatedUser;

  it('includes an attendance snapshot when the tenant is entitled to ATTENDANCE', async () => {
    const { controller, attendance } = buildController({
      role: 'EMPLOYEE',
      enabledModules: ['CORE_HR', 'LEAVE', 'ATTENDANCE'],
      attendanceRecord: {
        status: 'PRESENT',
        checkInAt: new Date('2026-09-22T04:00:00Z'),
        checkOutAt: null,
      },
    });

    const result = await controller.home(baseUser);

    expect(attendance.today).toHaveBeenCalledWith(baseUser);
    expect(result.todayAttendance).toEqual({
      status: 'PRESENT',
      checkInAt: new Date('2026-09-22T04:00:00Z'),
      checkOutAt: null,
      breaks: [],
      isOnBreak: false,
      effectiveMs: 3_600_000,
      targetHours: 8,
    });
  });

  it('sends today’s breaks, an open one with a null end, for the attendance ring', async () => {
    const { controller } = buildController({
      role: 'EMPLOYEE',
      enabledModules: ['CORE_HR', 'LEAVE', 'ATTENDANCE'],
      attendanceRecord: {
        status: 'PRESENT',
        checkInAt: new Date('2026-09-22T04:00:00Z'),
        checkOutAt: null,
        breaks: [
          {
            id: 'b1',
            startAt: new Date('2026-09-22T06:00:00Z'),
            endAt: new Date('2026-09-22T06:15:00Z'),
          },
          { id: 'b2', startAt: new Date('2026-09-22T08:00:00Z'), endAt: null },
        ],
      } as any,
    });

    const result = await controller.home(baseUser);

    expect(result.todayAttendance?.breaks).toEqual([
      { startAt: new Date('2026-09-22T06:00:00Z'), endAt: new Date('2026-09-22T06:15:00Z') },
      { startAt: new Date('2026-09-22T08:00:00Z'), endAt: null },
    ]);
  });

  it('omits the attendance snapshot when the plan does not include ATTENDANCE', async () => {
    const { controller, attendance } = buildController({
      role: 'EMPLOYEE',
      enabledModules: ['CORE_HR', 'LEAVE'],
    });

    const result = await controller.home(baseUser);

    expect(attendance.today).not.toHaveBeenCalled();
    expect(result.todayAttendance).toBeNull();
  });

  it('omits the attendance snapshot for a user with no linked employee record', async () => {
    const { controller, attendance } = buildController({
      role: 'EMPLOYEE',
      enabledModules: ['CORE_HR', 'LEAVE', 'ATTENDANCE'],
    });

    const result = await controller.home({ ...baseUser, employeeId: null });

    expect(attendance.today).not.toHaveBeenCalled();
    expect(result.todayAttendance).toBeNull();
  });

  it('includes the attendance snapshot on the admin view too', async () => {
    const { controller } = buildController({
      role: 'HR_MANAGER',
      enabledModules: ['CORE_HR', 'LEAVE', 'ATTENDANCE'],
      attendanceRecord: { status: 'LATE', checkInAt: new Date(), checkOutAt: null },
    });

    const result = await controller.home({ ...baseUser, role: 'HR_MANAGER' });

    expect(result.view).toBe('admin');
    expect(result.todayAttendance?.status).toBe('LATE');
  });

  it('adds the workforce insights to the admin view, telling them which optional modules the plan has', async () => {
    const { controller, insights } = buildController({
      role: 'COMPANY_ADMIN',
      enabledModules: ['CORE_HR', 'LEAVE', 'PAYROLL'],
    });

    const result: any = await controller.home({ ...baseUser, role: 'COMPANY_ADMIN' });

    expect(result.insights).toEqual({ activeHeadcount: 7 });
    expect(insights.build).toHaveBeenCalledWith({
      pendingApprovals: expect.any(Promise),
      attendance: false,
      payroll: true,
    });
    await expect(insights.build.mock.calls[0][0].pendingApprovals).resolves.toEqual([]);
  });

  it('adds the team and company panels to the employee view, passing the plan’s modules', async () => {
    const { controller, employeeInsights } = buildController({
      role: 'EMPLOYEE',
      enabledModules: ['CORE_HR', 'LEAVE', 'ATTENDANCE'],
    });

    const result: any = await controller.home(baseUser);

    expect(result.view).toBe('employee');
    expect(result.insights).toEqual({ myTeam: null });
    expect(employeeInsights.build).toHaveBeenCalledWith(baseUser, {
      attendance: true,
      leave: true,
    });
  });

  it('tells the employee panels when the plan has no Leave or Attendance', async () => {
    const { controller, employeeInsights } = buildController({
      role: 'EMPLOYEE',
      enabledModules: ['CORE_HR'],
    });

    await controller.home(baseUser);

    expect(employeeInsights.build).toHaveBeenCalledWith(baseUser, {
      attendance: false,
      leave: false,
    });
  });

  it('does not build the employee panels for the admin view', async () => {
    const { controller, employeeInsights } = buildController({
      role: 'HR_MANAGER',
      enabledModules: ['CORE_HR', 'LEAVE'],
    });

    await controller.home({ ...baseUser, role: 'HR_MANAGER' });

    expect(employeeInsights.build).not.toHaveBeenCalled();
  });

  describe('admin detail endpoints', () => {
    const adminUser = { ...baseUser, role: 'HR_MANAGER' } as AuthenticatedUser;

    it('returns everyone on leave today', async () => {
      const { controller, insights } = buildController({ role: 'HR_MANAGER', enabledModules: [] });

      await expect(controller.onLeave()).resolves.toEqual([{ id: 'l1' }]);
      expect(insights.onLeaveTodayDetail).toHaveBeenCalled();
    });

    it('returns every request waiting on the caller, not a trimmed five', async () => {
      const { controller, leave, insights } = buildController({
        role: 'HR_MANAGER',
        enabledModules: [],
      });
      leave.pendingApprovals.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

      await expect(controller.pendingApprovals(adminUser)).resolves.toEqual([
        { id: 'a' },
        { id: 'b' },
      ]);
      expect(leave.pendingApprovals).toHaveBeenCalledWith(adminUser);
      expect(insights.pendingApprovalsDetail).toHaveBeenCalledWith([{ id: 'a' }, { id: 'b' }]);
    });

    it('is limited to Company Admin and HR Manager', () => {
      const roles = (name: 'onLeave' | 'pendingApprovals') =>
        Reflect.getMetadata('roles', DashboardController.prototype[name]);

      expect(roles('onLeave')).toEqual(['COMPANY_ADMIN', 'HR_MANAGER']);
      expect(roles('pendingApprovals')).toEqual(['COMPANY_ADMIN', 'HR_MANAGER']);
    });
  });

  it('does not build admin insights for an Employee', async () => {
    const { controller, insights } = buildController({
      role: 'EMPLOYEE',
      enabledModules: ['CORE_HR'],
    });

    await controller.home(baseUser);

    expect(insights.build).not.toHaveBeenCalled();
  });
});
