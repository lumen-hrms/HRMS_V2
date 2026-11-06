import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PAUSED_WORKER, startBackgroundWorker } from '../common/background-workers';
import { PlatformPrismaClientProvider } from '../prisma/platform-prisma-client.provider';
import { TenantPrismaClientProvider } from '../prisma/tenant-prisma-client.provider';
import { withTenantContext } from '../prisma/with-tenant-context';
import { LEAVE_QUEUE } from './leave.constants';
import { LeaveEntitlementService } from './leave-entitlement.service';

/**
 * Daily repeatable job (registered once at boot) that keeps every set-up
 * tenant's balances in line with its leave policy, via
 * `LeaveEntitlementService` (rules in `leave-entitlement.ts`):
 *
 * 1. In the first week of a new leave year, carry unused balance forward
 *    (capped per type).
 * 2. Credit whatever the policy owes and the ledger doesn't hold yet — the
 *    ANNUAL grant at the start of the year (prorated for mid-year joiners),
 *    each MONTHLY/QUARTERLY period as it starts, and anything a newly added
 *    or back-dated employee missed.
 *
 * Both steps are ledger-idempotent, so a missed or re-run day never
 * double-credits. A tenant still in company setup is skipped — its policy
 * isn't final until setup is submitted, and submit credits the opening
 * year itself.
 *
 * V1 scope: loops per tenant rather than a batched cross-tenant query —
 * fine at startup/hospital-pilot scale, revisit if tenant volume grows.
 */
@Injectable()
@Processor(LEAVE_QUEUE, PAUSED_WORKER)
export class LeaveAccrualProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(LeaveAccrualProcessor.name);

  constructor(
    @InjectQueue(LEAVE_QUEUE) private readonly leaveQueue: Queue,
    private readonly platformPrisma: PlatformPrismaClientProvider,
    private readonly tenantPrismaRaw: TenantPrismaClientProvider,
    private readonly entitlement: LeaveEntitlementService,
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
    const tenants = await this.platformPrisma.tenant.findMany({
      where: { status: { not: 'SUSPENDED' } },
      select: { id: true },
    });
    for (const tenant of tenants) {
      try {
        await this.accrueForTenant(tenant.id, today);
      } catch (err) {
        // One tenant's bad data must not stop every other tenant's accrual.
        this.logger.error(
          `Leave accrual failed for tenant ${tenant.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  async accrueForTenant(tenantId: string, today: Date) {
    const client = withTenantContext(this.tenantPrismaRaw, tenantId);
    const setup = await client.tenantSetup.findUnique({
      where: { tenantId },
      select: { completedAt: true },
    });
    if (!setup?.completedAt) return;
    await this.entitlement.applyCarryForward(client, tenantId, today);
    await this.entitlement.applyPolicyDefaults(client, tenantId, today);
  }
}
