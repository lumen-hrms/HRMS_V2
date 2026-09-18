import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

/** Minimal fake of the tenant-scoped Prisma surface AttendanceService touches. */
function buildFakeTenantPrisma(overrides: Record<string, any> = {}) {
  const client = {
    attendanceRecord: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn((args: any) => ({ id: 'rec-1', ...args.create })),
      update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })),
      count: jest.fn().mockResolvedValue(0),
    },
    attendanceBreak: {
      findFirst: jest.fn(),
      create: jest.fn((args: any) => ({ id: 'brk-1', endAt: null, ...args.data })),
      update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })),
    },
    regularizationRequest: {
      create: jest.fn((args: any) => ({ id: 'reg-1', status: 'PENDING', ...args.data })),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })),
    },
    punch: { create: jest.fn().mockResolvedValue({ id: 'punch-1' }) },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    holiday: { findFirst: jest.fn().mockResolvedValue(null) },
    tenantSettings: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        weeklyOffDays: [0, 6],
        timezone: 'Asia/Kolkata',
        payrollCutoffDay: 25,
      }),
      update: jest.fn((args: any) => args.data),
    },
    employee: {
      // No per-employee shift override by default — resolveShift() falls
      // back to the tenant's `isDefault` shift.
      findUnique: jest.fn().mockResolvedValue({ shift: null }),
    },
    shift: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'shift-1',
        startTime: '09:00',
        graceMinutes: 15,
        minHoursFullDay: 8,
      }),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn((args: any) => ({ id: 'shift-new', ...args.data })),
      update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn().mockResolvedValue({ id: 'shift-1' }),
    },
    attendanceSettings: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        mode: 'SELF_SERVICE',
        captureMethods: ['WEB'],
        regularizationWindowDays: 7,
        regularizationMonthlyCap: 3,
        unactionedBehavior: 'AUTO_APPROVE',
      }),
      update: jest.fn((args: any) => args.data),
    },
    ...overrides,
  };
  return { tenantId: 'tenant-1', client };
}

function fakeLeave() {
  return { getBalances: jest.fn().mockResolvedValue([]), creditCompOff: jest.fn() };
}

function user(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    sub: 'user-1',
    tenantId: 'tenant-1',
    role: 'EMPLOYEE',
    email: 'e@test.com',
    employeeId: 'emp-1',
    ...overrides,
  };
}

describe('AttendanceService', () => {
  beforeEach(() => {
    // Fixed at 09:05 UTC — inside the 15min grace window, so clock-ins land PRESENT unless a test overrides the time.
    jest.useFakeTimers().setSystemTime(new Date('2026-03-02T09:05:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  describe('clockIn()', () => {
    it('creates a PRESENT record when within the grace window', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        attendanceRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn((args: any) => ({ id: 'rec-1', ...args.create })),
        },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      const result = await service.clockIn(user());
      expect(result.status).toBe('PRESENT');
      expect(result.checkInAt).toBeInstanceOf(Date);
    });

    it('marks LATE once past the grace window', async () => {
      jest.setSystemTime(new Date('2026-03-02T09:30:00Z'));
      const tenantPrisma = buildFakeTenantPrisma({
        attendanceRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn((args: any) => ({ id: 'rec-1', ...args.create })),
        },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      const result = await service.clockIn(user());
      expect(result.status).toBe('LATE');
    });

    it('rejects a second clock-in while already clocked in', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        attendanceRecord: {
          findUnique: jest.fn().mockResolvedValue({ checkInAt: new Date(), checkOutAt: null }),
          upsert: jest.fn(),
        },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      await expect(service.clockIn(user())).rejects.toThrow(BadRequestException);
    });

    it('rejects when the caller has no linked employee record', async () => {
      const tenantPrisma = buildFakeTenantPrisma();
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);
      await expect(service.clockIn(user({ employeeId: undefined }))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('marks HOLIDAY and credits comp-off when clocking in on a company holiday', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        attendanceRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn((args: any) => ({ id: 'rec-1', ...args.create })),
        },
        holiday: { findFirst: jest.fn().mockResolvedValue({ id: 'h-1', name: 'Republic Day' }) },
      });
      const leave = fakeLeave();
      const service = new AttendanceService(tenantPrisma as any, leave as any);

      const result = await service.clockIn(user());
      expect(result.status).toBe('HOLIDAY');
      expect(leave.creditCompOff).toHaveBeenCalledWith('emp-1', expect.any(Date), 'Republic Day');
    });

    it('marks WEEKLY_OFF and credits comp-off when clocking in on a weekly-off day', async () => {
      jest.setSystemTime(new Date('2026-03-01T09:05:00Z')); // a Sunday
      const tenantPrisma = buildFakeTenantPrisma({
        attendanceRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn((args: any) => ({ id: 'rec-1', ...args.create })),
        },
      });
      const leave = fakeLeave();
      const service = new AttendanceService(tenantPrisma as any, leave as any);

      const result = await service.clockIn(user());
      expect(result.status).toBe('WEEKLY_OFF');
      expect(leave.creditCompOff).toHaveBeenCalledWith('emp-1', expect.any(Date), 'weekly-off');
    });

    it('uses the employee’s own shift override instead of the tenant default', async () => {
      // 09:20 is LATE against the 09:00+15min tenant default, but PRESENT
      // against a 09:00+30min grace shift assigned directly to this employee.
      jest.setSystemTime(new Date('2026-03-02T09:20:00Z'));
      const tenantPrisma = buildFakeTenantPrisma({
        attendanceRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn((args: any) => ({ id: 'rec-1', ...args.create })),
        },
        employee: {
          findUnique: jest.fn().mockResolvedValue({
            shift: { id: 'shift-2', startTime: '09:00', graceMinutes: 30, minHoursFullDay: 8 },
          }),
        },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      const result = await service.clockIn(user());
      expect(result.status).toBe('PRESENT');
    });

    it('rejects clocking in when the tenant has no default shift configured', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        attendanceRecord: { findUnique: jest.fn().mockResolvedValue(null) },
        shift: { findFirst: jest.fn().mockResolvedValue(null) },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);
      await expect(service.clockIn(user())).rejects.toThrow(BadRequestException);
    });
  });

  describe('today()', () => {
    it('reports targetHours from the resolved shift’s minHoursFullDay, not a hardcoded constant', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        attendanceRecord: { findUnique: jest.fn().mockResolvedValue(null) },
        shift: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'shift-1',
            startTime: '09:00',
            graceMinutes: 15,
            minHoursFullDay: 9,
          }),
        },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      const result = await service.today(user());
      expect(result).toEqual({
        record: null,
        effectiveMs: 0,
        isOnBreak: false,
        targetHours: 9,
        overtimeMs: 0,
      });
    });

    it('reports overtime once effective time exceeds the shift target', async () => {
      const checkInAt = new Date('2026-03-02T09:00:00Z');
      const record = {
        checkInAt,
        checkOutAt: new Date('2026-03-02T20:00:00Z'), // 11h worked, 8h target -> 3h OT
        breaks: [],
      };
      const tenantPrisma = buildFakeTenantPrisma({
        attendanceRecord: { findUnique: jest.fn().mockResolvedValue(record) },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      const result = await service.today(user());
      expect(result.overtimeMs).toBe(3 * 3600 * 1000);
    });
  });

  describe('clockOut()', () => {
    it('rejects clocking out without having clocked in', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        attendanceRecord: { findUnique: jest.fn().mockResolvedValue(null) },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);
      await expect(service.clockOut(user())).rejects.toThrow(BadRequestException);
    });

    it('rejects clocking out with an open break', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        attendanceRecord: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'rec-1', checkInAt: new Date(), checkOutAt: null }),
        },
        attendanceBreak: { findFirst: jest.fn().mockResolvedValue({ id: 'brk-1', endAt: null }) },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);
      await expect(service.clockOut(user())).rejects.toThrow(BadRequestException);
    });
  });

  describe('startBreak() / endBreak()', () => {
    it('starts a break once clocked in, and rejects a second concurrent break', async () => {
      const record = { id: 'rec-1', checkInAt: new Date(), checkOutAt: null };
      const tenantPrisma = buildFakeTenantPrisma({
        attendanceRecord: { findUnique: jest.fn().mockResolvedValue(record) },
        attendanceBreak: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'brk-1', endAt: null }),
          create: jest.fn((args: any) => ({ id: 'brk-1', endAt: null, ...args.data })),
        },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      const started = await service.startBreak(user());
      expect(started.endAt).toBeNull();

      await expect(service.startBreak(user())).rejects.toThrow(BadRequestException);
    });

    it('rejects starting a break before clocking in', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        attendanceRecord: { findUnique: jest.fn().mockResolvedValue(null) },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);
      await expect(service.startBreak(user())).rejects.toThrow(BadRequestException);
    });

    it('rejects ending a break when none is in progress', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        attendanceRecord: { findUnique: jest.fn().mockResolvedValue({ id: 'rec-1' }) },
        attendanceBreak: { findFirst: jest.fn().mockResolvedValue(null) },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);
      await expect(service.endBreak(user())).rejects.toThrow(BadRequestException);
    });
  });

  describe('requestRegularization()', () => {
    it('creates a PENDING request for the current employee', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        attendanceRecord: { findUnique: jest.fn().mockResolvedValue(null) },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      const result = await service.requestRegularization(
        { targetDate: '2026-03-01', reasonType: 'MISSED_PUNCH_OUT', note: 'forgot' },
        user(),
      );
      expect(result.status).toBe('PENDING');
      expect(result.employeeId).toBe('emp-1');
    });

    it('flags the existing attendance record as PENDING_REGULARIZATION', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        attendanceRecord: {
          findUnique: jest.fn().mockResolvedValue({ id: 'rec-1' }),
          update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })),
        },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      await service.requestRegularization(
        { targetDate: '2026-03-01', reasonType: 'MISSED_PUNCH_OUT' },
        user(),
      );

      expect(tenantPrisma.client.attendanceRecord.update).toHaveBeenCalledWith({
        where: { id: 'rec-1' },
        data: { status: 'PENDING_REGULARIZATION' },
      });
    });

    it('rejects a target date further back than the regularization window', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        attendanceRecord: { findUnique: jest.fn().mockResolvedValue(null) },
        attendanceSettings: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            regularizationWindowDays: 7,
            regularizationMonthlyCap: 3,
          }),
        },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      // "today" is faked to 2026-03-02; 2026-02-01 is 29 days back.
      await expect(
        service.requestRegularization(
          { targetDate: '2026-02-01', reasonType: 'MISSED_PUNCH_OUT' },
          user(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a future target date', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        attendanceRecord: { findUnique: jest.fn().mockResolvedValue(null) },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      await expect(
        service.requestRegularization(
          { targetDate: '2026-03-10', reasonType: 'MISSED_PUNCH_OUT' },
          user(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects once the monthly regularization cap is reached', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        attendanceRecord: { findUnique: jest.fn().mockResolvedValue(null) },
        regularizationRequest: { count: jest.fn().mockResolvedValue(3) },
        attendanceSettings: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            regularizationWindowDays: 7,
            regularizationMonthlyCap: 3,
          }),
        },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      await expect(
        service.requestRegularization(
          { targetDate: '2026-03-01', reasonType: 'MISSED_PUNCH_OUT' },
          user(),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('pendingRegularizations()', () => {
    it('scopes a Line Manager to their recursive subtree', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        employee: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'sub-mgr', reportingManagerId: 'mgr-1' },
            { id: 'indirect-report', reportingManagerId: 'sub-mgr' },
          ]),
        },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      await service.pendingRegularizations(user({ role: 'LINE_MANAGER', employeeId: 'mgr-1' }));

      expect(tenantPrisma.client.regularizationRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'PENDING', employeeId: { in: ['sub-mgr', 'indirect-report'] } },
        }),
      );
    });

    it('shows every pending request to HR/Admin, unscoped', async () => {
      const tenantPrisma = buildFakeTenantPrisma();
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      await service.pendingRegularizations(user({ role: 'HR_MANAGER' }));

      expect(tenantPrisma.client.regularizationRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'PENDING' } }),
      );
    });
  });

  describe('approveRegularization() / rejectRegularization()', () => {
    it('approves a pending request and finalizes the day PRESENT/LATE from the requested time', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        regularizationRequest: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'reg-1',
            employeeId: 'emp-1',
            status: 'PENDING',
            targetDate: new Date('2026-03-01T00:00:00Z'),
            requestedCheckInAt: new Date('2026-03-01T09:00:00Z'),
            requestedCheckOutAt: new Date('2026-03-01T18:00:00Z'),
          }),
          update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })),
        },
        attendanceRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn((args: any) => ({ id: 'rec-1', ...args.create })),
        },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      const result = await service.approveRegularization(
        'reg-1',
        user({ role: 'HR_MANAGER', employeeId: 'hr-1' }),
        'looks right',
      );

      expect(result.status).toBe('APPROVED');
      expect(tenantPrisma.client.attendanceRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ status: 'PRESENT' }),
        }),
      );
      expect(tenantPrisma.client.auditLog.create).toHaveBeenCalled();
    });

    it('blocks a Line Manager from approving a request outside their subtree', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        regularizationRequest: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'reg-1',
            employeeId: 'someone-else',
            status: 'PENDING',
            targetDate: new Date('2026-03-01T00:00:00Z'),
          }),
        },
        employee: { findMany: jest.fn().mockResolvedValue([]) },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      await expect(
        service.approveRegularization('reg-1', user({ role: 'LINE_MANAGER', employeeId: 'mgr-1' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects deciding a request that is no longer pending', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        regularizationRequest: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 'reg-1', employeeId: 'emp-1', status: 'APPROVED' }),
        },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      await expect(
        service.approveRegularization('reg-1', user({ role: 'HR_MANAGER' })),
      ).rejects.toThrow(BadRequestException);
    });

    it('reject() reverts the day to its base status (holiday/weekly-off/absent)', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        regularizationRequest: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'reg-1',
            employeeId: 'emp-1',
            status: 'PENDING',
            attendanceRecordId: 'rec-1',
            targetDate: new Date('2026-03-02T00:00:00Z'), // a Monday — not weekly-off/holiday
          }),
          update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })),
        },
        attendanceRecord: { update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })) },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      const result = await service.rejectRegularization('reg-1', user({ role: 'HR_MANAGER' }));

      expect(result.status).toBe('REJECTED');
      expect(tenantPrisma.client.attendanceRecord.update).toHaveBeenCalledWith({
        where: { id: 'rec-1' },
        data: { status: 'ABSENT' },
      });
    });
  });

  describe('bulkApproveRegularizations()', () => {
    it('approves what it can and reports per-id failures without throwing', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        regularizationRequest: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValueOnce({
              id: 'reg-1',
              employeeId: 'emp-1',
              status: 'PENDING',
              targetDate: new Date('2026-03-01T00:00:00Z'),
            })
            .mockResolvedValueOnce({ id: 'reg-2', employeeId: 'emp-2', status: 'APPROVED' }),
          update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })),
        },
        attendanceRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn((args: any) => ({ id: 'rec-1', ...args.create })),
        },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      const results = await service.bulkApproveRegularizations(
        ['reg-1', 'reg-2'],
        user({ role: 'HR_MANAGER' }),
      );

      expect(results).toEqual([
        { id: 'reg-1', ok: true },
        { id: 'reg-2', ok: false, error: expect.any(String) },
      ]);
    });
  });

  describe('teamRoster()', () => {
    it('returns each recursive report with their record for the day (or null)', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        employee: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([{ id: 'report-1', reportingManagerId: 'mgr-1' }])
            .mockResolvedValueOnce([
              { id: 'report-1', firstName: 'A', lastName: 'B', department: { name: 'Eng' } },
            ]),
        },
        attendanceRecord: {
          findMany: jest.fn().mockResolvedValue([{ employeeId: 'report-1', status: 'PRESENT' }]),
        },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      const roster = await service.teamRoster(
        user({ role: 'LINE_MANAGER', employeeId: 'mgr-1' }),
        '2026-03-01',
      );

      expect(roster).toEqual([
        {
          employeeId: 'report-1',
          employeeName: 'A B',
          department: 'Eng',
          record: { employeeId: 'report-1', status: 'PRESENT' },
        },
      ]);
    });

    it('returns an empty roster for a Line Manager with no reports', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        employee: { findMany: jest.fn().mockResolvedValue([]) },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      const roster = await service.teamRoster(user({ role: 'LINE_MANAGER', employeeId: 'mgr-1' }));
      expect(roster).toEqual([]);
    });
  });

  describe('markAttendance()', () => {
    it('upserts the record with source MANUAL and writes an audit row', async () => {
      const tenantPrisma = buildFakeTenantPrisma();
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      await service.markAttendance(
        { employeeId: 'emp-2', date: '2026-03-01', status: 'PRESENT', reason: 'Forgot badge' },
        user({ role: 'HR_MANAGER', sub: 'hr-user-1' }),
      );

      expect(tenantPrisma.client.attendanceRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            employeeId: 'emp-2',
            status: 'PRESENT',
            source: 'MANUAL',
          }),
        }),
      );
      expect(tenantPrisma.client.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorUserId: 'hr-user-1',
            action: 'attendance.manually_marked',
            targetId: 'emp-2',
          }),
        }),
      );
    });
  });

  describe('getLopDays()', () => {
    it('counts ABSENT-status records for the employee/month', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        attendanceRecord: { count: jest.fn().mockResolvedValue(2) },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      const days = await service.getLopDays('emp-1', '2026-03');
      expect(days).toBe(2);
      expect(tenantPrisma.client.attendanceRecord.count).toHaveBeenCalledWith({
        where: {
          employeeId: 'emp-1',
          date: {
            gte: new Date('2026-03-01T00:00:00.000Z'),
            lt: new Date('2026-04-01T00:00:00.000Z'),
          },
          status: 'ABSENT',
        },
      });
    });
  });

  describe('cancelRegularization()', () => {
    it('rejects cancelling someone else’s request', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        regularizationRequest: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 'reg-1', employeeId: 'someone-else', status: 'PENDING' }),
        },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);
      await expect(service.cancelRegularization('reg-1', user())).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects cancelling a request that is no longer pending', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        regularizationRequest: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 'reg-1', employeeId: 'emp-1', status: 'APPROVED' }),
        },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);
      await expect(service.cancelRegularization('reg-1', user())).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('shifts', () => {
    it('unsets the previous default shift when creating a new default one', async () => {
      const tenantPrisma = buildFakeTenantPrisma();
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      await service.createShift({
        name: 'Night',
        startTime: '21:00',
        endTime: '06:00',
        isDefault: true,
      } as any);

      expect(tenantPrisma.client.shift.updateMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', isDefault: true },
        data: { isDefault: false },
      });
      expect(tenantPrisma.client.shift.create).toHaveBeenCalled();
    });

    it('404s updating a shift that does not exist', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        shift: { findUnique: jest.fn().mockResolvedValue(null) },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);
      await expect(service.updateShift('missing', { name: 'X' })).rejects.toThrow(
        'Shift not found',
      );
    });

    it('blocks deleting the default shift', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        shift: { findUnique: jest.fn().mockResolvedValue({ id: 'shift-1', isDefault: true }) },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);
      await expect(service.deleteShift('shift-1')).rejects.toThrow(BadRequestException);
    });

    it('deletes a non-default shift', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        shift: {
          findUnique: jest.fn().mockResolvedValue({ id: 'shift-2', isDefault: false }),
          delete: jest.fn().mockResolvedValue({ id: 'shift-2' }),
        },
      });
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);
      await expect(service.deleteShift('shift-2')).resolves.toEqual({ deleted: true });
    });
  });

  describe('getAttendanceConfig() / updateAttendanceConfig()', () => {
    it('merges attendance_settings with the general slice of tenant_settings', async () => {
      const tenantPrisma = buildFakeTenantPrisma();
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      const result = await service.getAttendanceConfig();
      expect(result).toEqual({
        mode: 'SELF_SERVICE',
        captureMethods: ['WEB'],
        regularizationWindowDays: 7,
        regularizationMonthlyCap: 3,
        unactionedBehavior: 'AUTO_APPROVE',
        timezone: 'Asia/Kolkata',
        weeklyOffDays: [0, 6],
        payrollCutoffDay: 25,
      });
    });

    it('only writes tenantSettings when a general field is actually given', async () => {
      const tenantPrisma = buildFakeTenantPrisma();
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      await service.updateAttendanceConfig({ regularizationWindowDays: 10 });

      expect(tenantPrisma.client.attendanceSettings.update).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        data: { regularizationWindowDays: 10 },
      });
      expect(tenantPrisma.client.tenantSettings.update).not.toHaveBeenCalled();
    });

    it('writes tenantSettings when a general field is given', async () => {
      const tenantPrisma = buildFakeTenantPrisma();
      const service = new AttendanceService(tenantPrisma as any, fakeLeave() as any);

      await service.updateAttendanceConfig({ weeklyOffDays: [0] });

      expect(tenantPrisma.client.tenantSettings.update).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        data: { timezone: undefined, weeklyOffDays: [0], payrollCutoffDay: undefined },
      });
    });
  });
});
