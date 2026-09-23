import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PlatformPrismaClientProvider } from '../prisma/platform-prisma-client.provider';
import { TenantPrismaClientProvider } from '../prisma/tenant-prisma-client.provider';
import { withTenantContext } from '../prisma/with-tenant-context';
import { NotificationDispatcher } from '../notifications/notification-dispatcher.service';
import { ATTENDANCE_QUEUE } from './attendance.constants';
import { baseStatusFor, isLateCheckIn } from './attendance.util';

/**
 * Two daily jobs (registered once at boot, same `upsertJobScheduler`
 * pattern as `LeaveAccrualProcessor`/`LoginAuditRetentionProcessor`) closing
 * the last two Attendance gaps (docs/MODULE_SPECS.md §5):
 *
 * - `finalize` — per tenant, per employee, finalizes YESTERDAY's attendance:
 *   holiday → weekly-off → punches → else a genuine unexplained ABSENT.
 *   Never touches a day that already has a real outcome (self-service
 *   clock-in, Leave's synchronous `ON_LEAVE` write, or an active
 *   regularization dispute).
 * - `resolve-cutoff` — on each tenant's own `payrollCutoffDay`, auto-resolves
 *   any regularization request still PENDING for a date before the cutoff,
 *   per `attendance_settings.unactionedBehavior`.
 */
@Injectable()
@Processor(ATTENDANCE_QUEUE)
export class AttendanceFinalizationProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(AttendanceFinalizationProcessor.name);

  constructor(
    @InjectQueue(ATTENDANCE_QUEUE) private readonly queue: Queue,
    private readonly platformPrisma: PlatformPrismaClientProvider,
    private readonly tenantPrismaRaw: TenantPrismaClientProvider,
    private readonly notifications: NotificationDispatcher,
  ) {
    super();
  }

  async onModuleInit() {
    await this.queue.upsertJobScheduler(
      'attendance-finalize-daily',
      { pattern: '0 2 * * *' },
      { name: 'finalize' },
    );
    await this.queue.upsertJobScheduler(
      'attendance-cutoff-daily',
      { pattern: '0 3 * * *' },
      { name: 'resolve-cutoff' },
    );
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'finalize') await this.runFinalization(new Date());
    if (job.name === 'resolve-cutoff') await this.runCutoffResolution(new Date());
  }

  async runFinalization(now: Date) {
    const y = new Date(now);
    y.setUTCDate(y.getUTCDate() - 1);
    const date = new Date(Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate()));

    const tenants = await this.platformPrisma.tenant.findMany({
      where: { status: { not: 'SUSPENDED' } },
      select: { id: true },
    });
    for (const tenant of tenants) {
      try {
        await this.finalizeForTenant(tenant.id, date);
      } catch (err) {
        this.logger.error(
          `Attendance finalization failed for tenant ${tenant.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  private async finalizeForTenant(tenantId: string, date: Date) {
    const client = withTenantContext(this.tenantPrismaRaw, tenantId);
    const dayEnd = new Date(date.getTime() + 24 * 3600 * 1000);

    const [holiday, settings, employees, existingRecords, defaultShift] = await Promise.all([
      client.holiday.findFirst({ where: { date } }),
      client.tenantSettings.findUniqueOrThrow({ where: { tenantId } }),
      client.employee.findMany({ select: { id: true, shiftId: true } }),
      client.attendanceRecord.findMany({ where: { date } }),
      client.shift.findFirst({ where: { tenantId, isDefault: true } }),
    ]);
    const existingByEmployee = new Map(existingRecords.map((r: any) => [r.employeeId, r]));
    const baseStatus = baseStatusFor(date, holiday, settings.weeklyOffDays);

    for (const emp of employees) {
      const existing = existingByEmployee.get(emp.id);
      // Already has a real outcome — self-service clock-in, Leave's
      // ON_LEAVE sync, an active regularization dispute, or a prior
      // finalization run. Leave it alone.
      if (
        existing &&
        (existing.checkInAt ||
          existing.status === 'ON_LEAVE' ||
          existing.status === 'PENDING_REGULARIZATION')
      ) {
        continue;
      }

      if (baseStatus !== 'ABSENT') {
        await client.attendanceRecord.upsert({
          where: { tenantId_employeeId_date: { tenantId, employeeId: emp.id, date } },
          create: { tenantId, employeeId: emp.id, date, status: baseStatus },
          update: { status: baseStatus },
        });
        continue;
      }

      const punches = await client.punch.findMany({
        where: { employeeId: emp.id, at: { gte: date, lt: dayEnd } },
        orderBy: { at: 'asc' },
      });
      if (punches.length > 0) {
        const ins = punches.filter((p: any) => p.direction === 'IN');
        const outs = punches.filter((p: any) => p.direction === 'OUT');
        const checkInAt: Date | undefined = ins[0]?.at;
        const checkOutAt: Date | undefined = outs[outs.length - 1]?.at;
        const shift = emp.shiftId
          ? await client.shift.findUnique({ where: { id: emp.shiftId } })
          : defaultShift;
        const status = checkInAt && shift && isLateCheckIn(checkInAt, shift) ? 'LATE' : 'PRESENT';
        await client.attendanceRecord.upsert({
          where: { tenantId_employeeId_date: { tenantId, employeeId: emp.id, date } },
          create: {
            tenantId,
            employeeId: emp.id,
            date,
            checkInAt,
            checkOutAt,
            status,
            source: 'IMPORT',
          },
          update: { checkInAt, checkOutAt, status, source: 'IMPORT' },
        });
        continue;
      }

      // No holiday, no weekly-off, no leave, no punch — genuine
      // unexplained absence. This is the day Attendance's `getLopDays()`
      // later counts for Payroll.
      await client.attendanceRecord.upsert({
        where: { tenantId_employeeId_date: { tenantId, employeeId: emp.id, date } },
        create: { tenantId, employeeId: emp.id, date, status: 'ABSENT' },
        update: { status: 'ABSENT' },
      });
    }
  }

  async runCutoffResolution(now: Date) {
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const tenants = await this.platformPrisma.tenant.findMany({
      where: { status: { not: 'SUSPENDED' } },
      select: { id: true },
    });
    for (const tenant of tenants) {
      try {
        await this.resolveCutoffForTenant(tenant.id, today);
      } catch (err) {
        this.logger.error(
          `Attendance cutoff resolution failed for tenant ${tenant.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  private async resolveCutoffForTenant(tenantId: string, today: Date) {
    const client = withTenantContext(this.tenantPrismaRaw, tenantId);
    const [tenantSettings, attendanceSettings] = await Promise.all([
      client.tenantSettings.findUniqueOrThrow({ where: { tenantId } }),
      client.attendanceSettings.findUniqueOrThrow({ where: { tenantId } }),
    ]);
    if (today.getUTCDate() !== tenantSettings.payrollCutoffDay) return;

    const pending = await client.regularizationRequest.findMany({
      where: { status: 'PENDING', targetDate: { lt: today } },
    });
    const resolution =
      attendanceSettings.unactionedBehavior === 'AUTO_APPROVE' ? 'APPROVED' : 'REJECTED';

    for (const req of pending) {
      await client.regularizationRequest.update({
        where: { id: req.id },
        data: { status: resolution, decidedAt: new Date() },
      });

      if (req.attendanceRecordId) {
        if (resolution === 'APPROVED') {
          await client.attendanceRecord.update({
            where: { id: req.attendanceRecordId },
            data: {
              checkInAt: req.requestedCheckInAt ?? undefined,
              checkOutAt: req.requestedCheckOutAt ?? undefined,
              status: 'PRESENT',
              source: 'MANUAL',
            },
          });
        } else {
          await client.attendanceRecord.update({
            where: { id: req.attendanceRecordId },
            data: { status: 'ABSENT' },
          });
        }
      }

      await client.auditLog
        .create({
          data: {
            tenantId,
            actorUserId: null,
            action: 'attendance.regularization_auto_resolved',
            targetType: 'employee',
            targetId: req.employeeId,
            metadata: {
              module: 'attendance',
              requestId: req.id,
              resolution,
              reason: 'payroll-cutoff-unactioned',
            },
          },
        })
        .catch(() => undefined);

      await this.notifications.notify({
        tenantId,
        template: 'REGULARIZATION_DECIDED',
        context: {
          requestId: req.id,
          targetDate: req.targetDate.toISOString().slice(0, 10),
          outcome: resolution,
          auto: true,
        },
        dedupeKey: `regularization:${req.id}:decided`,
        to: { employeeIds: [req.employeeId] },
      });
    }
  }
}
