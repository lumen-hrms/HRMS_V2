import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PAUSED_WORKER, startBackgroundWorker } from '../common/background-workers';
import { PlatformPrismaClientProvider } from '../prisma/platform-prisma-client.provider';
import { PLATFORM_ADMIN_QUEUE } from './platform-admin.constants';
import { PlatformAdminService } from './platform-admin.service';
import { BillingService } from '../billing/billing.service';

/**
 * Two daily repeatable jobs (registered once at boot, same
 * `upsertJobScheduler` pattern as `LeaveAccrualProcessor`):
 *
 * - `renew-subscriptions` — module 02's "scheduled renewal job" gap:
 *   `renewSubscription()` used to be a manual-only operator action; this
 *   drives it off `Subscription.renewsAt` instead.
 * - `expire-breakglass` — flips overdue ACTIVE break-glass grants to
 *   EXPIRED so a forgotten grant doesn't sit "active" past its TTL.
 * - `expire-trials` — moves TRIAL tenants whose trial window has passed to
 *   READ_ONLY (reads still work, writes are refused until converted).
 * - `enforce-grace` — ACTIVE tenants whose failed-payment grace window has
 *   passed go READ_ONLY (module 14).
 */
@Injectable()
@Processor(PLATFORM_ADMIN_QUEUE, PAUSED_WORKER)
export class PlatformScheduledJobsProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(PlatformScheduledJobsProcessor.name);

  constructor(
    @InjectQueue(PLATFORM_ADMIN_QUEUE) private readonly queue: Queue,
    private readonly platformPrisma: PlatformPrismaClientProvider,
    private readonly service: PlatformAdminService,
    private readonly billing: BillingService,
  ) {
    super();
  }

  /** Starts the worker + registers its schedule only where background workers
   *  are enabled (`common/background-workers.ts`). */
  async onApplicationBootstrap() {
    await startBackgroundWorker(this, async () => {
      await this.queue.upsertJobScheduler(
        'renew-subscriptions-daily',
        { pattern: '0 3 * * *' },
        { name: 'renew-subscriptions' },
      );
      await this.queue.upsertJobScheduler(
        'expire-breakglass-hourly',
        { pattern: '0 * * * *' },
        { name: 'expire-breakglass' },
      );
      await this.queue.upsertJobScheduler(
        'expire-trials-daily',
        { pattern: '30 4 * * *' },
        { name: 'expire-trials' },
      );
      await this.queue.upsertJobScheduler(
        'enforce-grace-daily',
        { pattern: '45 4 * * *' },
        { name: 'enforce-grace' },
      );
    });
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'renew-subscriptions') await this.runRenewals();
    if (job.name === 'expire-breakglass') await this.service.expireOverdueBreakGlassGrants();
    if (job.name === 'expire-trials') await this.service.expireTrials();
    if (job.name === 'enforce-grace') await this.billing.enforceGrace();
  }

  async runRenewals() {
    const due = await this.platformPrisma.subscription.findMany({
      where: { renewsAt: { lte: new Date() } },
      select: { tenantId: true },
    });
    for (const sub of due) {
      try {
        await this.service.renewSubscription(sub.tenantId, 'system:scheduled-renewal');
      } catch (err) {
        this.logger.error(
          `Scheduled renewal failed for tenant ${sub.tenantId}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
    return due.length;
  }
}
