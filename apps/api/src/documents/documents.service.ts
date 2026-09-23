import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Document, DocumentCategory, DocumentOwnerType, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { StorageService } from '../storage/storage.service';
import { recursiveReportIds } from '../common/reporting-hierarchy';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { assertValidUpload, DOCUMENTS_QUEUE } from './documents.constants';

const ADMIN_ROLES = ['COMPANY_ADMIN', 'HR_MANAGER'];
const DOWNLOAD_URL_TTL_SECONDS = 300;

export const SCAN_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  // Removed either way so the sweep can re-add the same jobId later —
  // BullMQ silently ignores an add whose jobId still exists in Redis.
  removeOnComplete: true,
  removeOnFail: true,
} as const;

export function scanJobId(documentId: string) {
  return `scan-${documentId}`;
}

export interface UploadInput {
  employeeId: string;
  ownerType: DocumentOwnerType;
  /** Required for LEAVE_REQUEST / REGULARIZATION, omitted for EMPLOYEE_PROFILE. */
  ownerId?: string;
  file: Express.Multer.File | undefined;
  label?: string;
  category?: DocumentCategory;
}

/** What leaves the API — never the storage key (module 09 §1). */
export function toDocumentDto(doc: Document) {
  return {
    id: doc.id,
    employeeId: doc.employeeId,
    ownerType: doc.ownerType,
    ownerId: doc.ownerId,
    label: doc.label,
    category: doc.category,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    scanStatus: doc.scanStatus,
    uploadedByName: doc.uploadedByName,
    uploadedAt: doc.uploadedAt,
  };
}
export type DocumentDto = ReturnType<typeof toDocumentDto>;

/** email local-part → "Jane Doe" style label, same as EmployeesService's. */
function humanizeEmail(email: string): string {
  return email
    .split('@')[0]
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function ownerSegment(ownerType: DocumentOwnerType, ownerId?: string): string {
  switch (ownerType) {
    case 'EMPLOYEE_PROFILE':
      return 'profile';
    case 'LEAVE_REQUEST':
      return `leave/${ownerId}`;
    case 'REGULARIZATION':
      return `regularization/${ownerId}`;
  }
}

/**
 * Module 09 — the one pipeline every user-uploaded file goes through
 * (docs/modules/09_DOCUMENTS.md). Owner modules (Leave, Attendance) do
 * their own "may this user attach to this record" checks and then call
 * `upload()`; this service never imports them, so there's no circular
 * module dependency.
 *
 * Visibility (RULE-4) mirrors EmployeesService.scopeFor — self for an
 * Employee, self + recursive subtree for a Line Manager, whole tenant
 * otherwise — via the shared pure `recursiveReportIds`, not an
 * EmployeesService import (Employees depends on this module, not the other
 * way round).
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly storage: StorageService,
    @InjectQueue(DOCUMENTS_QUEUE) private readonly queue: Queue,
  ) {}

  // ---- Upload ----

  /**
   * Profile-document upload matrix (module 09 §8): Admin/HR onto anyone, an
   * Employee onto themselves only — a role×self check, not row visibility
   * (a Line Manager can *see* a report but not upload for them).
   */
  async uploadProfileDocument(
    employeeId: string,
    file: Express.Multer.File | undefined,
    label: string | undefined,
    category: DocumentCategory | undefined,
    actor: AuthenticatedUser,
  ) {
    const canUpload =
      ADMIN_ROLES.includes(actor.role) ||
      (actor.role === 'EMPLOYEE' && actor.employeeId === employeeId);
    if (!canUpload) {
      throw new ForbiddenException('You cannot upload documents for this employee');
    }
    await this.assertEmployeeExists(employeeId);
    return this.upload({ employeeId, ownerType: 'EMPLOYEE_PROFILE', file, label, category }, actor);
  }

  /**
   * Validates, stores, records and enqueues a scan. The caller has already
   * authorized `actor` against the owner record. For LEAVE_REQUEST /
   * REGULARIZATION the previous live attachment is soft-deleted (RULE-5).
   */
  async upload(input: UploadInput, actor: AuthenticatedUser): Promise<DocumentDto> {
    assertValidUpload(input.file);
    const file = input.file;
    if (input.ownerType !== 'EMPLOYEE_PROFILE' && !input.ownerId) {
      throw new BadRequestException(`ownerId is required for ${input.ownerType}`);
    }

    const tenantId = this.tenantPrisma.tenantId;
    const key = this.storage.buildKey(
      tenantId,
      input.employeeId,
      file.originalname,
      ownerSegment(input.ownerType, input.ownerId),
    );
    await this.storage.upload(key, file.buffer, file.mimetype);

    let doc: Document;
    try {
      doc = await this.tenantPrisma.client.document.create({
        data: {
          tenantId,
          employeeId: input.employeeId,
          ownerType: input.ownerType,
          ownerId: input.ownerType === 'EMPLOYEE_PROFILE' ? null : input.ownerId,
          label: input.label?.trim() || file.originalname,
          category: input.category ?? 'OTHER',
          storageKey: key,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          uploadedById: actor.sub,
          uploadedByName: actor.email ? humanizeEmail(actor.email) : null,
        },
      });
    } catch (err) {
      // RULE-7: never leave an orphaned object behind a failed request.
      await this.storage.delete(key).catch(() => undefined);
      throw err;
    }

    if (input.ownerType !== 'EMPLOYEE_PROFILE') {
      await this.tenantPrisma.client.document.updateMany({
        where: {
          ownerType: input.ownerType,
          ownerId: input.ownerId,
          deletedAt: null,
          id: { not: doc.id },
        },
        data: { deletedAt: new Date(), deletedById: actor.sub },
      });
    }

    await this.enqueueScan(tenantId, doc.id);
    await this.audit(actor, 'documents.uploaded', doc);
    return toDocumentDto(doc);
  }

  // ---- Read ----

  /** EMPLOYEE_PROFILE documents of one employee, non-deleted, scoped. */
  async listProfileDocuments(employeeId: string, actor: AuthenticatedUser) {
    await this.assertEmployeeExists(employeeId);
    await this.assertEmployeeVisible(employeeId, actor);
    const docs = await this.tenantPrisma.client.document.findMany({
      where: { employeeId, ownerType: 'EMPLOYEE_PROFILE', deletedAt: null },
      orderBy: { uploadedAt: 'desc' },
    });
    return docs.map(toDocumentDto);
  }

  /**
   * The live attachment per owner id, for owner modules to fold into their
   * own DTOs. No scope check — callers only pass ids of records they've
   * already scoped for this user.
   */
  async attachmentsFor(
    ownerType: DocumentOwnerType,
    ownerIds: string[],
  ): Promise<Map<string, DocumentDto>> {
    if (ownerIds.length === 0) return new Map();
    const docs = await this.tenantPrisma.client.document.findMany({
      where: { ownerType, ownerId: { in: ownerIds }, deletedAt: null },
    });
    return new Map(docs.map((d) => [d.ownerId!, toDocumentDto(d)]));
  }

  /**
   * RULE-2: a URL is only ever issued for a visible, non-deleted, CLEAN
   * document. The issue is audit-logged *before* the URL is returned — if
   * the audit write fails, no URL leaves the server.
   */
  async getDownloadUrl(documentId: string, actor: AuthenticatedUser) {
    const doc = await this.findVisible(documentId, actor);
    switch (doc.scanStatus) {
      case 'PENDING_SCAN':
        throw new ConflictException('This file is still being scanned — try again shortly.');
      case 'SCAN_FAILED':
        throw new ConflictException(
          'This file could not be scanned yet — it will be retried automatically.',
        );
      case 'INFECTED':
        throw new GoneException('This file was blocked: malware was detected on upload.');
    }
    await this.tenantPrisma.client.auditLog.create({
      data: this.auditData(actor, 'documents.downloaded', doc),
    });
    const url = await this.storage.getPresignedDownloadUrl(
      doc.storageKey,
      DOWNLOAD_URL_TTL_SECONDS,
      doc.label,
    );
    return { url, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
  }

  // ---- Manage (Admin/HR — enforced by the controller's @Roles) ----

  async setCategory(documentId: string, category: DocumentCategory, actor: AuthenticatedUser) {
    const doc = await this.findVisible(documentId, actor);
    if (doc.ownerType !== 'EMPLOYEE_PROFILE') {
      throw new BadRequestException('Only profile documents have a category');
    }
    const updated = await this.tenantPrisma.client.document.update({
      where: { id: documentId },
      data: { category },
    });
    return toDocumentDto(updated);
  }

  /** Soft delete (V1 retention decision, module 09 §1) — the object is kept. */
  async softDelete(documentId: string, actor: AuthenticatedUser) {
    const doc = await this.findVisible(documentId, actor);
    await this.tenantPrisma.client.document.update({
      where: { id: documentId },
      data: { deletedAt: new Date(), deletedById: actor.sub },
    });
    await this.audit(actor, 'documents.deleted', doc);
    return { deleted: true };
  }

  // ---- Internals ----

  private async findVisible(documentId: string, actor: AuthenticatedUser) {
    const doc = await this.tenantPrisma.client.document.findFirst({
      where: { id: documentId, deletedAt: null },
    });
    if (!doc) throw new NotFoundException('Document not found');
    await this.assertEmployeeVisible(doc.employeeId, actor);
    return doc;
  }

  /** RLS-scoped, so another tenant's employee id 404s exactly like a made-up one. */
  private async assertEmployeeExists(employeeId: string) {
    const employee = await this.tenantPrisma.client.employee.findUnique({
      where: { id: employeeId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
  }

  /** 404 (not 403) when out of scope — don't confirm the record exists. */
  private async assertEmployeeVisible(employeeId: string, actor: AuthenticatedUser) {
    if (actor.role === 'EMPLOYEE') {
      if (actor.employeeId === employeeId) return;
      throw new NotFoundException('Document not found');
    }
    if (actor.role === 'LINE_MANAGER') {
      if (!actor.employeeId) throw new NotFoundException('Document not found');
      if (actor.employeeId === employeeId) return;
      const edges = await this.tenantPrisma.client.employee.findMany({
        select: { id: true, reportingManagerId: true },
      });
      if (recursiveReportIds(edges, actor.employeeId).has(employeeId)) return;
      throw new NotFoundException('Document not found');
    }
    // Company Admin / HR Manager / Auditor: whole tenant (RLS bounds it).
  }

  private async enqueueScan(tenantId: string, documentId: string) {
    try {
      await this.queue.add(
        'scan',
        { tenantId, documentId },
        {
          ...SCAN_JOB_OPTIONS,
          jobId: scanJobId(documentId),
        },
      );
    } catch (err) {
      // The row is PENDING_SCAN either way; the sweep re-enqueues it.
      this.logger.warn(`Could not enqueue scan for document ${documentId}: ${String(err)}`);
    }
  }

  private auditData(
    actor: AuthenticatedUser,
    action: string,
    doc: Document,
  ): Prisma.AuditLogUncheckedCreateInput {
    return {
      tenantId: this.tenantPrisma.tenantId,
      actorUserId: actor.sub,
      action,
      targetType: 'document',
      targetId: doc.id,
      metadata: {
        module: 'documents',
        employeeId: doc.employeeId,
        ownerType: doc.ownerType,
        ownerId: doc.ownerId,
        label: doc.label,
      },
    };
  }

  /** Best-effort for upload/delete — the state change already committed. */
  private async audit(actor: AuthenticatedUser, action: string, doc: Document) {
    await this.tenantPrisma.client.auditLog
      .create({ data: this.auditData(actor, action, doc) })
      .catch((err) => this.logger.warn(`Audit write failed for ${action}: ${String(err)}`));
  }
}
