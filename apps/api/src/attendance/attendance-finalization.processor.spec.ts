import { AttendanceFinalizationProcessor } from './attendance-finalization.processor';
import * as withTenantContextModule from '../prisma/with-tenant-context';

jest.mock('../prisma/with-tenant-context');

function buildTenantClient(overrides: Record<string, any> = {}) {
  return {
    holiday: { findFirst: jest.fn().mockResolvedValue(null) },
    tenantSettings: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ weeklyOffDays: [0, 6], payrollCutoffDay: 25 }),
    },
    attendanceSettings: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ unactionedBehavior: 'AUTO_APPROVE' }),
    },
    employee: { findMany: jest.fn().mockResolvedValue([]) },
    attendanceRecord: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    },
    shift: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    punch: { findMany: jest.fn().mockResolvedValue([]) },
    regularizationRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
    },
    auditLog: { create: jest.fn().mockReturnValue({ catch: () => Promise.resolve() }) },
    ...overrides,
  };
}

function buildProcessor(tenantIds: string[], clientOverrides: Record<string, any> = {}) {
  const client = buildTenantClient(clientOverrides);
  (withTenantContextModule.withTenantContext as jest.Mock).mockReturnValue(client);

  const platformPrisma = {
    tenant: { findMany: jest.fn().mockResolvedValue(tenantIds.map((id) => ({ id }))) },
  };
  const queue = { upsertJobScheduler: jest.fn() };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const processor = new AttendanceFinalizationProcessor(
    queue as any,
    platformPrisma as any,
    {} as any,
    notifications as any,
  );
  return { processor, client, platformPrisma, queue, notifications };
}

describe('AttendanceFinalizationProcessor', () => {
  it('registers both daily repeatable jobs on module init', async () => {
    const { processor, queue } = buildProcessor([]);
    await processor.onModuleInit();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'attendance-finalize-daily',
      { pattern: '0 2 * * *' },
      { name: 'finalize' },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'attendance-cutoff-daily',
      { pattern: '0 3 * * *' },
      { name: 'resolve-cutoff' },
    );
  });

  describe('runFinalization()', () => {
    it('marks a day HOLIDAY without touching punches', async () => {
      const { processor, client } = buildProcessor(['t1'], {
        holiday: { findFirst: jest.fn().mockResolvedValue({ id: 'h-1', name: 'Republic Day' }) },
        employee: { findMany: jest.fn().mockResolvedValue([{ id: 'emp-1', shiftId: null }]) },
      });

      await processor.runFinalization(new Date('2026-03-03T02:00:00Z'));

      expect(client.attendanceRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ status: 'HOLIDAY' }) }),
      );
      expect(client.punch.findMany).not.toHaveBeenCalled();
    });

    it('marks a day WEEKLY_OFF per tenant_settings.weeklyOffDays', async () => {
      const { processor, client } = buildProcessor(['t1'], {
        employee: { findMany: jest.fn().mockResolvedValue([{ id: 'emp-1', shiftId: null }]) },
      });

      // now = 2026-03-02T02:00Z -> target (yesterday) = 2026-03-01, a Sunday.
      await processor.runFinalization(new Date('2026-03-02T02:00:00Z'));

      expect(client.attendanceRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ status: 'WEEKLY_OFF' }) }),
      );
    });

    it('derives PRESENT/LATE from punches when neither holiday nor weekly-off apply', async () => {
      const { processor, client } = buildProcessor(['t1'], {
        employee: { findMany: jest.fn().mockResolvedValue([{ id: 'emp-1', shiftId: null }]) },
        shift: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'shift-1', startTime: '09:00', graceMinutes: 15 }),
          findUnique: jest.fn().mockResolvedValue(null),
        },
        punch: {
          findMany: jest.fn().mockResolvedValue([
            { direction: 'IN', at: new Date('2026-03-02T09:05:00Z') },
            { direction: 'OUT', at: new Date('2026-03-02T18:00:00Z') },
          ]),
        },
      });

      await processor.runFinalization(new Date('2026-03-03T02:00:00Z'));

      expect(client.attendanceRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ status: 'PRESENT', source: 'IMPORT' }),
        }),
      );
    });

    it('marks a genuine unexplained absence ABSENT', async () => {
      const { processor, client } = buildProcessor(['t1'], {
        employee: { findMany: jest.fn().mockResolvedValue([{ id: 'emp-1', shiftId: null }]) },
      });

      await processor.runFinalization(new Date('2026-03-03T02:00:00Z'));

      expect(client.attendanceRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ status: 'ABSENT' }) }),
      );
    });

    it('never touches a day that already has a real outcome', async () => {
      const { processor, client } = buildProcessor(['t1'], {
        employee: { findMany: jest.fn().mockResolvedValue([{ id: 'emp-1', shiftId: null }]) },
        attendanceRecord: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ employeeId: 'emp-1', checkInAt: new Date(), status: 'PRESENT' }]),
          upsert: jest.fn(),
          update: jest.fn(),
        },
      });

      await processor.runFinalization(new Date('2026-03-03T02:00:00Z'));

      expect(client.attendanceRecord.upsert).not.toHaveBeenCalled();
    });

    it('skips an employee whose day is under an active regularization dispute', async () => {
      const { processor, client } = buildProcessor(['t1'], {
        employee: { findMany: jest.fn().mockResolvedValue([{ id: 'emp-1', shiftId: null }]) },
        attendanceRecord: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              { employeeId: 'emp-1', checkInAt: null, status: 'PENDING_REGULARIZATION' },
            ]),
          upsert: jest.fn(),
          update: jest.fn(),
        },
      });

      await processor.runFinalization(new Date('2026-03-03T02:00:00Z'));

      expect(client.attendanceRecord.upsert).not.toHaveBeenCalled();
    });
  });

  describe('runCutoffResolution()', () => {
    it('no-ops for a tenant not at its payroll cut-off day today', async () => {
      const { processor, client } = buildProcessor(['t1'], {
        tenantSettings: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ weeklyOffDays: [0, 6], payrollCutoffDay: 25 }),
        },
      });

      await processor.runCutoffResolution(new Date('2026-03-10T03:00:00Z'));

      expect(client.regularizationRequest.findMany).not.toHaveBeenCalled();
    });

    it('auto-approves unactioned requests on the cut-off day when configured AUTO_APPROVE', async () => {
      const { processor, client, notifications } = buildProcessor(['t1'], {
        tenantSettings: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ weeklyOffDays: [0, 6], payrollCutoffDay: 25 }),
        },
        attendanceSettings: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ unactionedBehavior: 'AUTO_APPROVE' }),
        },
        regularizationRequest: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'reg-1',
              employeeId: 'emp-1',
              attendanceRecordId: 'rec-1',
              targetDate: new Date('2026-03-20T00:00:00Z'),
              requestedCheckInAt: null,
              requestedCheckOutAt: null,
            },
          ]),
          update: jest.fn().mockResolvedValue(undefined),
        },
      });

      await processor.runCutoffResolution(new Date('2026-03-25T03:00:00Z'));

      expect(client.regularizationRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'reg-1' },
          data: expect.objectContaining({ status: 'APPROVED' }),
        }),
      );
      expect(client.attendanceRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rec-1' },
          data: expect.objectContaining({ status: 'PRESENT' }),
        }),
      );
      expect(client.auditLog.create).toHaveBeenCalled();
      expect(notifications.notify).toHaveBeenCalledWith({
        tenantId: 't1',
        template: 'REGULARIZATION_DECIDED',
        context: {
          requestId: 'reg-1',
          targetDate: '2026-03-20',
          outcome: 'APPROVED',
          auto: true,
        },
        dedupeKey: 'regularization:reg-1:decided',
        to: { employeeIds: ['emp-1'] },
      });
    });

    it('auto-rejects unactioned requests when configured AUTO_REJECT', async () => {
      const { processor, client } = buildProcessor(['t1'], {
        tenantSettings: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ weeklyOffDays: [0, 6], payrollCutoffDay: 25 }),
        },
        attendanceSettings: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ unactionedBehavior: 'AUTO_REJECT' }),
        },
        regularizationRequest: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'reg-1',
              employeeId: 'emp-1',
              attendanceRecordId: 'rec-1',
              targetDate: new Date('2026-03-20T00:00:00Z'),
            },
          ]),
          update: jest.fn().mockResolvedValue(undefined),
        },
      });

      await processor.runCutoffResolution(new Date('2026-03-25T03:00:00Z'));

      expect(client.regularizationRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
      );
      expect(client.attendanceRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rec-1' }, data: { status: 'ABSENT' } }),
      );
    });
  });
});
