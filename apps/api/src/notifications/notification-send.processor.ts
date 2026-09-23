import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { PAUSED_WORKER, startBackgroundWorker } from '../common/background-workers';
import type { AppConfig } from '../config/configuration';
import { PlatformPrismaClientProvider } from '../prisma/platform-prisma-client.provider';
import { TenantPrismaClientProvider } from '../prisma/tenant-prisma-client.provider';
import { withTenantContext } from '../prisma/with-tenant-context';
import {
  NOTIFICATIONS_QUEUE,
  SEND_JOB_OPTIONS,
  SendJobData,
  sendJobId,
} from './notification-dispatcher.service';
import { SesEmailSender } from './ses-email.sender';
import { render } from './templates';

/** A QUEUED row older than this is assumed to have lost its job. */
const STALE_QUEUED_MS = 10 * 60 * 1000;

/**
 * Module 10 §3.1 steps 4–5. `send`: render the row's template and hand it
 * to SES; SENT only once SES returns a MessageId (RULE-5). An error bumps
 * `attempts`, records `lastError` and rethrows so BullMQ retries; the final
 * attempt marks FAILED. `sweep` (every 10 min) re-enqueues stale QUEUED
 * rows in every tenant — e.g. Redis was down when `notify()` ran.
 *
 * Runs outside a request: tenant rows via `withTenantContext` on
 * `hrms_app`; only the tenant's display *name* is read from the platform
 * schema (for the From line / footer).
 */
@Injectable()
@Processor(NOTIFICATIONS_QUEUE, PAUSED_WORKER)
export class NotificationSendProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationSendProcessor.name);
  private readonly appBaseUrl: string;

  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
    private readonly platformPrisma: PlatformPrismaClientProvider,
    private readonly tenantPrismaRaw: TenantPrismaClientProvider,
    private readonly sender: SesEmailSender,
    config: ConfigService<AppConfig, true>,
  ) {
    super();
    this.appBaseUrl = config.get('appBaseUrl', { infer: true });
  }

  /** Starts the worker + registers its schedule only where background workers
   *  are enabled (`common/background-workers.ts`). */
  async onApplicationBootstrap() {
    await startBackgroundWorker(this, async () => {
      await this.queue.upsertJobScheduler(
        'notifications-sweep',
        { pattern: '*/10 * * * *' },
        { name: 'sweep' },
      );
    });
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'send') {
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await this.send(job.data as SendJobData, isFinalAttempt);
    } else if (job.name === 'sweep') {
      await this.sweep(new Date());
    }
  }

  async send({ tenantId, logId }: SendJobData, isFinalAttempt: boolean) {
    const client = withTenantContext(this.tenantPrismaRaw, tenantId);
    const row = await client.notificationLog.findUnique({ where: { id: logId } });
    if (!row || row.status !== 'QUEUED') return; // already sent / failed / gone

    try {
      const tenant = await this.platformPrisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true },
      });
      const tenantName = tenant?.name ?? 'Your company';
      const email = render(row.template, row.context, {
        appBaseUrl: this.appBaseUrl,
        tenantName,
      });
      const messageId = await this.sender.send({
        ...email,
        to: row.recipientEmail,
        fromName: `${tenantName} via Lumen HRMS`,
      });
      await client.notificationLog.update({
        where: { id: logId },
        data: {
          status: 'SENT',
          providerMessageId: messageId,
          sentAt: new Date(),
          attempts: { increment: 1 },
          lastError: null,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Email ${logId} (tenant ${tenantId}) failed: ${message}`);
      await client.notificationLog.update({
        where: { id: logId },
        data: {
          attempts: { increment: 1 },
          lastError: message.slice(0, 1000),
          ...(isFinalAttempt && { status: 'FAILED' as const }),
        },
      });
      throw err;
    }
  }

  async sweep(now: Date) {
    const tenants = await this.platformPrisma.tenant.findMany({ select: { id: true } });
    const staleBefore = new Date(now.getTime() - STALE_QUEUED_MS);
    for (const tenant of tenants) {
      const client = withTenantContext(this.tenantPrismaRaw, tenant.id);
      const rows = await client.notificationLog.findMany({
        where: { status: 'QUEUED', createdAt: { lt: staleBefore } },
        select: { id: true },
      });
      for (const row of rows) {
        await this.queue.add('send', { tenantId: tenant.id, logId: row.id } satisfies SendJobData, {
          ...SEND_JOB_OPTIONS,
          jobId: sendJobId(row.id),
        });
      }
    }
  }
}
