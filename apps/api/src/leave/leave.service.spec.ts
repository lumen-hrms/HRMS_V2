import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { LeaveService } from './leave.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

/** Nested relations `toRequestDto` always reads off a LeaveRequest row —
 *  every fake `leaveRequest.create`/`update` below must return these. */
const FAKE_REQUEST_RELS = {
  employee: { id: 'emp-1', firstName: 'Test', lastName: 'User', department: null },
  leaveType: { id: 'lt-1', name: 'Test Type', code: 'TT', colorToken: '#000000' },
  approvals: [] as unknown[],
};

/** Minimal fake of the tenant-scoped Prisma surface LeaveService touches. */
function buildFakeTenantPrisma(overrides: Record<string, any> = {}) {
  const client = {
    leaveType: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'lt-1', name: 'Test Type', minNoticeDays: 0, genderRestriction: 'ANY' }),
    },
    employee: { findMany: jest.fn(), findUniqueOrThrow: jest.fn(), findUnique: jest.fn() },
    leaveBalance: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn().mockResolvedValue({ accrued: 0, used: 0 }),
    },
    leaveRequest: {
      create: jest.fn((args: any) => ({ id: 'req-1', ...args.data, ...FAKE_REQUEST_RELS })),
      update: jest.fn((args: any) => ({ id: args.where.id, ...args.data, ...FAKE_REQUEST_RELS })),
      findUniqueOrThrow: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    leaveApproval: { create: jest.fn() },
    leaveLedgerEntry: { create: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) },
    tenantSettings: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        leaveApprovalLevels: 2,
        leaveEscalationDays: 3,
        weeklyOffDays: [0, 6],
        allowLopRequests: true,
        fyStartMonth: 1,
      }),
    },
    holiday: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    attendanceRecord: { upsert: jest.fn(), deleteMany: jest.fn() },
    ...overrides,
  };
  return {
    tenantId: 'tenant-1',
    client,
  };
}

/** LeaveService only needs storage for the attachment endpoint (untested here) and a BullMQ queue stub. */
function buildFakeStorage() {
  return {} as any;
}

function buildFakeQueue() {
  return { add: jest.fn() } as any;
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

describe('LeaveService', () => {
  describe('apply()', () => {
    it('computes an inclusive day count and flags LOP when balance is insufficient', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        employee: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 'emp-1', reportingManagerId: 'mgr-1' }),
        },
        leaveBalance: {
          findUnique: jest.fn().mockResolvedValue({ accrued: 2, used: 0 }), // only 2 days available
        },
      });
      const service = new LeaveService(tenantPrisma as any, buildFakeStorage(), buildFakeQueue());

      const result = await service.apply(
        { leaveTypeId: 'lt-1', startDate: '2026-01-05', endDate: '2026-01-07' }, // 3 inclusive days
        user(),
      );

      expect(result.days).toBe(3);
      expect(result.isLop).toBe(true);
      expect(result.status).toBe('PENDING_L1'); // has a reporting manager
    });

    it('does not flag LOP when balance covers the request, and starts at PENDING_L2 with no manager', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        employee: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'emp-1', reportingManagerId: null }),
        },
        leaveBalance: {
          findUnique: jest.fn().mockResolvedValue({ accrued: 18, used: 2 }),
        },
      });
      const service = new LeaveService(tenantPrisma as any, buildFakeStorage(), buildFakeQueue());

      const result = await service.apply(
        { leaveTypeId: 'lt-1', startDate: '2026-01-05', endDate: '2026-01-05' }, // 1 day
        user(),
      );

      expect(result.days).toBe(1);
      expect(result.isLop).toBe(false);
      expect(result.status).toBe('PENDING_L2'); // no reporting manager to give L1
    });

    it('rejects an end date before the start date', async () => {
      const tenantPrisma = buildFakeTenantPrisma();
      const service = new LeaveService(tenantPrisma as any, buildFakeStorage(), buildFakeQueue());
      await expect(
        service.apply(
          { leaveTypeId: 'lt-1', startDate: '2026-01-10', endDate: '2026-01-05' },
          user(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the caller has no linked employee record', async () => {
      const tenantPrisma = buildFakeTenantPrisma();
      const service = new LeaveService(tenantPrisma as any, buildFakeStorage(), buildFakeQueue());
      await expect(
        service.apply(
          { leaveTypeId: 'lt-1', startDate: '2026-01-05', endDate: '2026-01-05' },
          user({ employeeId: undefined }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an LOP-inducing request when the tenant disallows LOP', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        employee: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 'emp-1', reportingManagerId: 'mgr-1' }),
        },
        leaveBalance: {
          findUnique: jest.fn().mockResolvedValue({ accrued: 1, used: 0 }), // request exceeds this
        },
        tenantSettings: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            leaveApprovalLevels: 2,
            leaveEscalationDays: 3,
            weeklyOffDays: [0, 6],
            allowLopRequests: false,
            fyStartMonth: 1,
          }),
        },
      });
      const service = new LeaveService(tenantPrisma as any, buildFakeStorage(), buildFakeQueue());

      await expect(
        service.apply(
          { leaveTypeId: 'lt-1', startDate: '2026-01-05', endDate: '2026-01-07' },
          user(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a request that falls short of the leave type’s minimum notice', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        employee: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 'emp-1', reportingManagerId: 'mgr-1' }),
        },
        leaveBalance: {
          findUnique: jest.fn().mockResolvedValue({ accrued: 30, used: 0 }),
        },
        leaveType: {
          findMany: jest.fn(),
          findFirst: jest.fn(),
          create: jest.fn(),
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 'lt-1', name: 'Earned Leave', minNoticeDays: 30 }),
        },
      });
      const service = new LeaveService(tenantPrisma as any, buildFakeStorage(), buildFakeQueue());

      await expect(
        service.apply(
          // A fixed past date is always short of any positive minNoticeDays.
          { leaveTypeId: 'lt-1', startDate: '2026-01-05', endDate: '2026-01-05' },
          user(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a request against a leave type restricted to the other gender', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        employee: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 'emp-1', reportingManagerId: 'mgr-1', gender: 'male' }),
        },
        leaveBalance: {
          findUnique: jest.fn().mockResolvedValue({ accrued: 10, used: 0 }),
        },
        leaveType: {
          findMany: jest.fn(),
          findFirst: jest.fn(),
          create: jest.fn(),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'lt-1',
            name: 'Maternity Leave',
            minNoticeDays: 0,
            genderRestriction: 'FEMALE',
          }),
        },
      });
      const service = new LeaveService(tenantPrisma as any, buildFakeStorage(), buildFakeQueue());

      await expect(
        service.apply(
          { leaveTypeId: 'lt-1', startDate: '2026-01-05', endDate: '2026-01-05' },
          user(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows a gender-restricted request when the employee has no recognized gender on file', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        employee: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 'emp-1', reportingManagerId: 'mgr-1', gender: null }),
        },
        leaveBalance: {
          findUnique: jest.fn().mockResolvedValue({ accrued: 10, used: 0 }),
        },
        leaveType: {
          findMany: jest.fn(),
          findFirst: jest.fn(),
          create: jest.fn(),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'lt-1',
            name: 'Maternity Leave',
            minNoticeDays: 0,
            genderRestriction: 'FEMALE',
          }),
        },
      });
      const service = new LeaveService(tenantPrisma as any, buildFakeStorage(), buildFakeQueue());

      const result = await service.apply(
        { leaveTypeId: 'lt-1', startDate: '2026-01-05', endDate: '2026-01-05' },
        user(),
      );
      expect(result.status).toBe('PENDING_L1');
    });
  });

  describe('approve() — two-level chain', () => {
    it('L1: only the reporting manager or an HR admin may approve, and it moves to PENDING_L2', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        leaveRequest: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'req-1',
            status: 'PENDING_L1',
            employeeId: 'emp-1',
            leaveTypeId: 'lt-1',
            days: 2,
            isLop: false,
            startDate: new Date('2026-01-05'),
            endDate: new Date('2026-01-05'),
            employee: { reportingManagerId: 'mgr-1' },
          }),
          update: jest.fn((args: any) => ({
            id: args.where.id,
            ...args.data,
            ...FAKE_REQUEST_RELS,
          })),
        },
      });
      const service = new LeaveService(tenantPrisma as any, buildFakeStorage(), buildFakeQueue());

      // A random employee (not the manager) must be rejected.
      await expect(
        service.approve('req-1', user({ employeeId: 'someone-else', role: 'EMPLOYEE' })),
      ).rejects.toThrow(ForbiddenException);

      // The actual reporting manager succeeds.
      const result = await service.approve(
        'req-1',
        user({ employeeId: 'mgr-1', role: 'LINE_MANAGER' }),
      );
      expect(result.status).toBe('PENDING_L2');
    });

    it('L2: only HR Manager/Company Admin may give final approval, and it credits the leave balance', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        leaveRequest: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'req-1',
            status: 'PENDING_L2',
            employeeId: 'emp-1',
            leaveTypeId: 'lt-1',
            days: 2,
            isLop: false,
            startDate: new Date('2026-01-05'),
            endDate: new Date('2026-01-05'),
            employee: { reportingManagerId: 'mgr-1' },
          }),
          update: jest.fn((args: any) => ({
            id: args.where.id,
            ...args.data,
            ...FAKE_REQUEST_RELS,
          })),
        },
      });
      const service = new LeaveService(tenantPrisma as any, buildFakeStorage(), buildFakeQueue());

      // A Line Manager cannot give L2 approval.
      await expect(
        service.approve('req-1', user({ employeeId: 'mgr-1', role: 'LINE_MANAGER' })),
      ).rejects.toThrow(ForbiddenException);

      const result = await service.approve('req-1', user({ role: 'HR_MANAGER' }));
      expect(result.status).toBe('APPROVED');
      expect(tenantPrisma.client.leaveBalance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ used: { increment: 2 } }),
        }),
      );
      expect(tenantPrisma.client.attendanceRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ status: 'ON_LEAVE' }),
        }),
      );
    });

    it('does not credit the balance when the approved request was flagged LOP, but still marks attendance ON_LEAVE', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        leaveRequest: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'req-1',
            status: 'PENDING_L2',
            employeeId: 'emp-1',
            leaveTypeId: 'lt-1',
            days: 5,
            isLop: true,
            startDate: new Date('2026-01-05'),
            endDate: new Date('2026-01-05'),
            employee: { reportingManagerId: 'mgr-1' },
          }),
          update: jest.fn((args: any) => ({
            id: args.where.id,
            ...args.data,
            ...FAKE_REQUEST_RELS,
          })),
        },
      });
      const service = new LeaveService(tenantPrisma as any, buildFakeStorage(), buildFakeQueue());

      await service.approve('req-1', user({ role: 'COMPANY_ADMIN' }));
      expect(tenantPrisma.client.leaveBalance.upsert).not.toHaveBeenCalled();
      expect(tenantPrisma.client.attendanceRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ status: 'ON_LEAVE' }),
        }),
      );
    });
  });

  describe('cancel()', () => {
    it('removes the ON_LEAVE attendance marker when cancelling an approved request', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        leaveRequest: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'req-1',
            status: 'APPROVED',
            employeeId: 'emp-1',
            leaveTypeId: 'lt-1',
            days: 2,
            isLop: false,
            startDate: new Date('2026-01-05'),
            endDate: new Date('2026-01-05'),
          }),
          update: jest.fn((args: any) => ({
            id: args.where.id,
            ...args.data,
            ...FAKE_REQUEST_RELS,
          })),
        },
      });
      const service = new LeaveService(tenantPrisma as any, buildFakeStorage(), buildFakeQueue());

      const result = await service.cancel('req-1', user());
      expect(result.status).toBe('CANCELLED');
      expect(tenantPrisma.client.attendanceRecord.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ON_LEAVE' }),
        }),
      );
    });
  });

  describe('creditCompOff()', () => {
    it('no-ops when the tenant has no designated comp-off leave type', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        leaveType: {
          findMany: jest.fn(),
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
          findUniqueOrThrow: jest.fn(),
        },
      });
      const service = new LeaveService(tenantPrisma as any, buildFakeStorage(), buildFakeQueue());

      await service.creditCompOff('emp-1', new Date('2026-01-10'), 'Republic Day');
      expect(tenantPrisma.client.leaveBalance.upsert).not.toHaveBeenCalled();
    });

    it('credits +1 day once, and is idempotent for the same employee/day', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        leaveType: {
          findMany: jest.fn(),
          findFirst: jest.fn().mockResolvedValue({ id: 'co-1' }),
          create: jest.fn(),
          findUniqueOrThrow: jest.fn(),
        },
        leaveLedgerEntry: {
          create: jest.fn(),
          groupBy: jest.fn().mockResolvedValue([]),
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(null) // first call: not yet credited
            .mockResolvedValueOnce({ id: 'ledger-1' }), // second call: already credited
        },
      });
      const service = new LeaveService(tenantPrisma as any, buildFakeStorage(), buildFakeQueue());

      await service.creditCompOff('emp-1', new Date('2026-01-10'), 'Republic Day');
      expect(tenantPrisma.client.leaveBalance.upsert).toHaveBeenCalledTimes(1);
      expect(tenantPrisma.client.leaveLedgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ source: 'COMP_OFF_CREDIT', delta: 1 }),
        }),
      );

      await service.creditCompOff('emp-1', new Date('2026-01-10'), 'Republic Day');
      expect(tenantPrisma.client.leaveBalance.upsert).toHaveBeenCalledTimes(1); // still 1 — no double-credit
    });
  });

  describe('assertCanViewEmployee() — Line Manager visibility', () => {
    it('rejects a Line Manager who does not directly manage the target employee', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        employee: {
          findUnique: jest.fn().mockResolvedValue({ reportingManagerId: 'someone-else' }),
        },
      });
      const service = new LeaveService(tenantPrisma as any, buildFakeStorage(), buildFakeQueue());

      await expect(
        service.getBalances(
          'target-emp',
          user({ role: 'LINE_MANAGER', employeeId: 'mgr-1' }),
          2026,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows a Line Manager who directly manages the target employee', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        employee: {
          findUnique: jest.fn().mockResolvedValue({ reportingManagerId: 'mgr-1' }),
        },
        leaveBalance: { findMany: jest.fn().mockResolvedValue([]) },
      });
      const service = new LeaveService(tenantPrisma as any, buildFakeStorage(), buildFakeQueue());

      await expect(
        service.getBalances(
          'target-emp',
          user({ role: 'LINE_MANAGER', employeeId: 'mgr-1' }),
          2026,
        ),
      ).resolves.toEqual([]);
    });
  });

  describe('apply() — working-day counting', () => {
    it('excludes weekly-offs and holidays from the day count', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        employee: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 'emp-1', reportingManagerId: 'mgr-1' }),
        },
        leaveBalance: {
          findUnique: jest.fn().mockResolvedValue({ accrued: 30, used: 0 }),
        },
        tenantSettings: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            leaveApprovalLevels: 2,
            leaveEscalationDays: 3,
            weeklyOffDays: [0, 6],
            allowLopRequests: true,
            fyStartMonth: 1,
          }),
        },
        // 2026-01-05 is a Monday; the range runs Mon-Sat (6 calendar days).
        // Sat (01-10) is a weekly-off and 01-07 is a declared holiday, so only
        // 4 of the 6 calendar days should count.
        holiday: {
          findMany: jest.fn().mockResolvedValue([{ date: new Date('2026-01-07') }]),
        },
      });
      const service = new LeaveService(tenantPrisma as any, buildFakeStorage(), buildFakeQueue());

      const result = await service.apply(
        { leaveTypeId: 'lt-1', startDate: '2026-01-05', endDate: '2026-01-10' },
        user(),
      );

      expect(result.days).toBe(4);
    });
  });

  describe('apply() — configurable approval depth', () => {
    it('routes straight to PENDING_L2 when the tenant is configured for a single approval level', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        employee: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 'emp-1', reportingManagerId: 'mgr-1' }),
        },
        leaveBalance: {
          findUnique: jest.fn().mockResolvedValue({ accrued: 10, used: 0 }),
        },
        tenantSettings: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            leaveApprovalLevels: 1,
            leaveEscalationDays: 3,
            weeklyOffDays: [0, 6],
            allowLopRequests: true,
            fyStartMonth: 1,
          }),
        },
      });
      const service = new LeaveService(tenantPrisma as any, buildFakeStorage(), buildFakeQueue());

      const result = await service.apply(
        { leaveTypeId: 'lt-1', startDate: '2026-01-05', endDate: '2026-01-05' },
        user(),
      );

      // Monday — even though the employee has a reporting manager, a
      // single-level tenant skips L1 entirely.
      expect(result.status).toBe('PENDING_L2');
    });
  });

  describe('apply() — escalation scheduling', () => {
    it('enqueues a delayed escalation job sized to the tenant’s escalation window', async () => {
      const tenantPrisma = buildFakeTenantPrisma({
        employee: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 'emp-1', reportingManagerId: 'mgr-1' }),
        },
        leaveBalance: { findUnique: jest.fn().mockResolvedValue({ accrued: 10, used: 0 }) },
        tenantSettings: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            leaveApprovalLevels: 2,
            leaveEscalationDays: 5,
            weeklyOffDays: [0, 6],
          }),
        },
      });
      const queue = buildFakeQueue();
      const service = new LeaveService(tenantPrisma as any, buildFakeStorage(), queue);

      const result = await service.apply(
        { leaveTypeId: 'lt-1', startDate: '2026-01-05', endDate: '2026-01-05' },
        user(),
      );

      expect(queue.add).toHaveBeenCalledWith(
        'escalate',
        { tenantId: 'tenant-1', leaveRequestId: result.id, level: 1 },
        expect.objectContaining({ delay: 5 * 24 * 60 * 60 * 1000 }),
      );
    });
  });
});
