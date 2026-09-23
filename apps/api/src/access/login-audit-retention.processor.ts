import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PAUSED_WORKER, startBackgroundWorker } from '../common/background-workers';
import { PlatformPrismaClientProvider } from '../prisma/platform-prisma-client.provider';
import { TenantPrismaClientProvider } from '../prisma/tenant-prisma-client.provider';
import { withTenantContext } from '../prisma/with-tenant-context';
import { ACCESS_QUEUE } from './access.constants';

const RETENTION_YEARS = 2;

/**
 * Daily repeatable job (registered once at boot). Enforces the FR-AUTH-008
 * 2-year retention on `login_audit_entries` — see module 01 §9's "Known
 * gaps". Runs per tenant (RLS is tenant-scoped, so a bare cross-tenant
 * delete isn't possible on the `hrms_app` connection) using the same
 * `upsertJobScheduler` pattern as `LeaveAccrualProcessor`.
 */
@Injectable()
@Processor(ACCESS_QUEUE, PAUSED_WORKER)
export class LoginAuditRetentionProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(LoginAuditRetentionProcessor.name);

  constructor(
    @InjectQueue(ACCESS_QUEUE) private readonly accessQueue: Queue,
    private readonly platformPrisma: PlatformPrismaClientProvider,
    private readonly tenantPrismaRaw: TenantPrismaClientProvider,
  ) {
    super();
  }

  /** Starts the worker + registers its schedule only where background workers
   *  are enabled (`common/background-workers.ts`). */
  async onApplicationBootstrap() {
    await startBackgroundWorker(this, async () => {
      await this.accessQueue.upsertJobScheduler(
        'login-audit-retention-daily',
        { pattern: '0 2 * * *' },
        { name: 'purge' },
      );
    });
  }

  async process(job: Job): Promise<void> {
    if (job.name !== 'purge') return;
    await this.runPurge(new Date());
  }

  async runPurge(now: Date) {
    const cutoff = new Date(now);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - RETENTION_YEARS);

    const tenants = await this.platformPrisma.tenant.findMany({ select: { id: true } });
    for (const tenant of tenants) {
      const client = withTenantContext(this.tenantPrismaRaw, tenant.id);
      const { count } = await client.loginAuditEntry.deleteMany({
        where: { at: { lt: cutoff } },
      });
      if (count > 0) {
        this.logger.log(
          `Purged ${count} login audit entries older than ${cutoff.toISOString()} for tenant ${tenant.id}`,
        );
      }
    }
  }
}
