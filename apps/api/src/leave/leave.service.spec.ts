import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { LeaveService } from './leave.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

/** Minimal fake of the tenant-scoped Prisma surface LeaveService touches. */
function buildFakeTenantPrisma(overrides: Record<string, any> = {}) {
  const client = {
    leaveType: { findMany: jest.fn(), create: jest.fn(), findUniqueOrThrow: jest.fn() },
    employee: { findMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    leaveBalance: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    leaveRequest: {
      create: jest.fn((args: any) => ({ id: 'req-1', ...args.data })),
      update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })),
      findUniqueOrThrow: jest.fn(),
    },
    ...overrides,
  };
  return {
    tenantId: 'tenant-1',
    client,
  };
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
      const service = new LeaveService(tenantPrisma as any);

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
      const service = new LeaveService(tenantPrisma as any);

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
      const service = new LeaveService(tenantPrisma as any);
      await expect(
        service.apply(
          { leaveTypeId: 'lt-1', startDate: '2026-01-10', endDate: '2026-01-05' },
          user(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the caller has no linked employee record', async () => {
      const tenantPrisma = buildFakeTenantPrisma();
      const service = new LeaveService(tenantPrisma as any);
      await expect(
        service.apply(
          { leaveTypeId: 'lt-1', startDate: '2026-01-05', endDate: '2026-01-05' },
          user({ employeeId: undefined }),
        ),
      ).rejects.toThrow(BadRequestException);
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
            employee: { reportingManagerId: 'mgr-1' },
          }),
          update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })),
        },
      });
      const service = new LeaveService(tenantPrisma as any);

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
            employee: { reportingManagerId: 'mgr-1' },
          }),
          update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })),
        },
      });
      const service = new LeaveService(tenantPrisma as any);

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
    });

    it('does not credit the balance when the approved request was flagged LOP', async () => {
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
            employee: { reportingManagerId: 'mgr-1' },
          }),
          update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })),
        },
      });
      const service = new LeaveService(tenantPrisma as any);

      await service.approve('req-1', user({ role: 'COMPANY_ADMIN' }));
      expect(tenantPrisma.client.leaveBalance.upsert).not.toHaveBeenCalled();
    });
  });
});
