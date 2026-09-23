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
  const controller = new DashboardController(tenantPrisma, leave, attendance, platformPrisma);
  return { controller, attendance, platformPrisma };
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
      isOnBreak: false,
      effectiveMs: 3_600_000,
      targetHours: 8,
    });
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
});
