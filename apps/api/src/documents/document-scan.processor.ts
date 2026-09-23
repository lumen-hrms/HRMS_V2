import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PlatformPrismaClientProvider } from '../prisma/platform-prisma-client.provider';
import { TenantPrismaClientProvider } from '../prisma/tenant-prisma-client.provider';
import { withTenantContext } from '../prisma/with-tenant-context';
import { StorageService } from '../storage/storage.service';
import { ClamAvScanner } from './clamav.scanner';
import { NotificationDispatcher } from '../notifications/notification-dispatcher.service';
import { DOCUMENTS_QUEUE } from './documents.constants';
import { SCAN_JOB_OPTIONS, scanJobId } from './documents.service';

/** A PENDING_SCAN row older than this is assumed to have lost its job. */
const STALE_PENDING_MS = 10 * 60 * 1000;

export interface ScanJobData {
  tenantId: string;
  documentId: string;
}

/**
 * Module 09 §4.4. Two jobs on the `documents` queue:
 *
 * - `scan` — stream one document to clamd. CLEAN → downloadable; FOUND →
 *   object deleted, row INFECTED (RULE-3), audited. A scanner error
 *   rethrows so BullMQ retries; the final attempt marks SCAN_FAILED
 *   (still undownloadable — fail closed).
 * - `sweep` — every 15 minutes, re-enqueue stale PENDING_SCAN and all
 *   SCAN_FAILED rows in every tenant, so a lost job or a clamd outage
 *   heals without a human.
 *
 * Runs outside a request, so every query goes through `withTenantContext`
 * on the NOBYPASSRLS `hrms_app` connection, like Leave's processors.
 */
@Injectable()
@Processor(DOCUMENTS_QUEUE)
export class DocumentScanProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(DocumentScanProcessor.name);

  constructor(
    @InjectQueue(DOCUMENTS_QUEUE) private readonly queue: Queue,
    private readonly platformPrisma: PlatformPrismaClientProvider,
    private readonly tenantPrismaRaw: TenantPrismaClientProvider,
    private readonly storage: StorageService,
    private readonly scanner: ClamAvScanner,
    private readonly notifications: NotificationDispatcher,
  ) {
    super();
  }

  async onModuleInit() {
    await this.queue.upsertJobScheduler(
      'documents-scan-sweep',
      { pattern: '*/15 * * * *' },
      { name: 'sweep' },
    );
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'scan') {
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await this.scanDocument(job.data as ScanJobData, isFinalAttempt);
    } else if (job.name === 'sweep') {
      await this.sweep(new Date());
    }
  }

  async scanDocument({ tenantId, documentId }: ScanJobData, isFinalAttempt: boolean) {
    const client = withTenantContext(this.tenantPrismaRaw, tenantId);
    const doc = await client.document.findUnique({ where: { id: documentId } });
    // Already decided (a duplicate job), or deleted before we got to it.
    if (!doc || doc.deletedAt || doc.scanStatus === 'CLEAN' || doc.scanStatus === 'INFECTED') {
      return;
    }

    let result;
    try {
      const content = await this.storage.download(doc.storageKey);
      result = await this.scanner.scan(content);
    } catch (err) {
      this.logger.warn(`Scan of document ${documentId} failed: ${String(err)}`);
      if (isFinalAttempt) {
        await client.document.update({
          where: { id: documentId },
          data: { scanStatus: 'SCAN_FAILED' },
        });
      }
      throw err;
    }

    if (result.clean) {
      await client.document.update({
        where: { id: documentId },
        data: { scanStatus: 'CLEAN', scannedAt: new Date(), scanSignature: null },
      });
      return;
    }

    await this.storage.delete(doc.storageKey);
    await client.document.update({
      where: { id: documentId },
      data: { scanStatus: 'INFECTED', scannedAt: new Date(), scanSignature: result.signature },
    });
    await client.auditLog.create({
      data: {
        tenantId,
        actorUserId: null,
        action: 'documents.infected',
        targetType: 'document',
        targetId: doc.id,
        metadata: {
          module: 'documents',
          employeeId: doc.employeeId,
          ownerType: doc.ownerType,
          ownerId: doc.ownerId,
          label: doc.label,
          signature: result.signature,
          uploadedById: doc.uploadedById,
        },
      },
    });
    this.logger.warn(`Document ${documentId} (tenant ${tenantId}) INFECTED: ${result.signature}`);
    await this.notifications.notify({
      tenantId,
      template: 'DOCUMENT_BLOCKED',
      context: { documentLabel: doc.label },
      dedupeKey: `document:${doc.id}:blocked`,
      to: { userIds: [doc.uploadedById] },
    });
  }

  async sweep(now: Date) {
    const tenants = await this.platformPrisma.tenant.findMany({ select: { id: true } });
    const staleBefore = new Date(now.getTime() - STALE_PENDING_MS);
    for (const tenant of tenants) {
      const client = withTenantContext(this.tenantPrismaRaw, tenant.id);
      const docs = await client.document.findMany({
        where: {
          deletedAt: null,
          OR: [
            { scanStatus: 'PENDING_SCAN', uploadedAt: { lt: staleBefore } },
            { scanStatus: 'SCAN_FAILED' },
          ],
        },
        select: { id: true },
      });
      for (const doc of docs) {
        await this.queue.add(
          'scan',
          { tenantId: tenant.id, documentId: doc.id } satisfies ScanJobData,
          { ...SCAN_JOB_OPTIONS, jobId: scanJobId(doc.id) },
        );
      }
    }
  }
}
