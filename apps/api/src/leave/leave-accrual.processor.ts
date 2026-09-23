import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { AccrualFrequency } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import { PAUSED_WORKER, startBackgroundWorker } from '../common/background-workers';
import { PlatformPrismaClientProvider } from '../prisma/platform-prisma-client.provider';
import { TenantPrismaClientProvider } from '../prisma/tenant-prisma-client.provider';
import { withTenantContext } from '../prisma/with-tenant-context';
import { LEAVE_QUEUE } from './leave.constants';
import { resolveLeaveYear } from './leave-year.util';

const ACCRUAL_DIVISOR: Record<'MONTHLY' | 'QUARTERLY', number> = { MONTHLY: 12, QUARTERLY: 4 };

/**
 * Daily repeatable job (registered once at boot). Only does real work on the
 * 1st of a month: credits MONTHLY leave types every month, QUARTERLY types
 * every Jan/Apr/Jul/Oct. ANNUAL types are unaffected — those are still
 * seeded via the manual `initialize/:year` endpoint. Idempotent per
 * employee/type/month via a `LeaveLedgerEntry` existence check, so a missed
 * or re-run day never double-credits.
 *
 * V1 scope: this loops per tenant/type/employee rather than a batched SQL
 * update — fine at startup/hospital-pilot scale, revisit if tenant or
 * headcount volume grows.
 */
@Injectable()
@Processor(LEAVE_QUEUE, PAUSED_WORKER)
export class LeaveAccrualProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(LEAVE_QUEUE) private readonly leaveQueue: Queue,
    private readonly platformPrisma: PlatformPrismaClientProvider,
    private readonly tenantPrismaRaw: TenantPrismaClientProvider,
  ) {
    super();
  }

  /** Starts the worker + registers its schedule only where background workers
   *  are enabled (`common/background-workers.ts`). */
  async onApplicationBootstrap() {
    await startBackgroundWorker(this, async () => {
      await this.leaveQueue.upsertJobScheduler(
        'leave-accrual-daily',
        { pattern: '0 1 * * *' },
        { name: 'accrue' },
      );
    });
  }

  async process(job: Job): Promise<void> {
    if (job.name !== 'accrue') return;
    await this.runAccrual(new Date());
  }

  async runAccrual(today: Date) {
    if (today.getUTCDate() !== 1) return;

    const tenants = await this.platformPrisma.tenant.findMany({
      where: { status: { not: 'SUSPENDED' } },
      select: { id: true },
    });
    for (const tenant of tenants) {
      await this.accrueForTenant(tenant.id, today);
    }
  }

  private async accrueForTenant(tenantId: string, today: Date) {
    const client = withTenantContext(this.tenantPrismaRaw, tenantId);
    const year = today.getUTCFullYear();
    const month = today.getUTCMonth(); // 0-based
    const isQuarterBoundary = [0, 3, 6, 9].includes(month);
    const frequencies: AccrualFrequency[] = isQuarterBoundary
      ? [AccrualFrequency.MONTHLY, AccrualFrequency.QUARTERLY]
      : [AccrualFrequency.MONTHLY];

    const types = await client.leaveType.findMany({
      where: { accrualFrequency: { in: frequencies } },
    });
    if (types.length === 0) return;
    const settings = await client.tenantSettings.findUniqueOrThrow({ where: { tenantId } });
    const leaveYear = resolveLeaveYear(today, settings.fyStartMonth);
    const employees = await client.employee.findMany({
      select: { id: true, dateOfJoining: true },
    });

    for (const type of types) {
      const divisor = ACCRUAL_DIVISOR[type.accrualFrequency as 'MONTHLY' | 'QUARTERLY'];
      const fullIncrement = Number(type.annualQuota) / divisor;
      const periodStart = new Date(Date.UTC(year, month, 1));
      const periodEnd = new Date(Date.UTC(year, month + 1, 1));

      for (const emp of employees) {
        // Not yet joined this period — no accrual at all.
        if (emp.dateOfJoining && emp.dateOfJoining.getTime() >= periodEnd.getTime()) continue;

        // Joined mid-period — prorate this period's increment by the days actually employed.
        let increment = fullIncrement;
        if (
          emp.dateOfJoining &&
          emp.dateOfJoining.getTime() >= periodStart.getTime() &&
          emp.dateOfJoining.getTime() < periodEnd.getTime()
        ) {
          const fraction =
            (periodEnd.getTime() - emp.dateOfJoining.getTime()) /
            (periodEnd.getTime() - periodStart.getTime());
          increment = fullIncrement * fraction;
        }

        const already = await client.leaveLedgerEntry.findFirst({
          where: {
            employeeId: emp.id,
            leaveTypeId: type.id,
            source: 'ACCRUAL',
            occurredAt: { gte: periodStart, lt: periodEnd },
          },
        });
        if (already) continue;

        const existing = await client.leaveBalance.findUnique({
          where: {
            tenantId_employeeId_leaveTypeId_year: {
              tenantId,
              employeeId: emp.id,
              leaveTypeId: type.id,
              year: leaveYear,
            },
          },
        });
        const currentAccrued = existing ? Number(existing.accrued) : 0;
        const newAccrued = Math.min(currentAccrued + increment, Number(type.annualQuota));
        const actualIncrement = newAccrued - currentAccrued;
        if (actualIncrement <= 0) continue;

        const balance = await client.leaveBalance.upsert({
          where: {
            tenantId_employeeId_leaveTypeId_year: {
              tenantId,
              employeeId: emp.id,
              leaveTypeId: type.id,
              year: leaveYear,
            },
          },
          create: {
            tenantId,
            employeeId: emp.id,
            leaveTypeId: type.id,
            year: leaveYear,
            accrued: newAccrued,
            used: 0,
          },
          update: { accrued: newAccrued },
        });

        await client.leaveLedgerEntry.create({
          data: {
            tenantId,
            employeeId: emp.id,
            leaveTypeId: type.id,
            delta: actualIncrement,
            balanceAfter: newAccrued - Number(balance.used),
            source: 'ACCRUAL',
            note: `Periodic accrual for ${year}-${String(month + 1).padStart(2, '0')}`,
            actorUserId: null,
          },
        });
      }
    }
  }
}
