import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export interface AuditLogInput {
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  /** Always namespaced with `module` so cross-module queries (§12) can filter by it. */
  metadata: Record<string, unknown>;
  ipAddress?: string | null;
}

export interface AuditQueryFilter {
  module?: string;
  action?: string; // exact match or `prefix.` when it ends with a dot
  targetType?: string;
  q?: string; // matches actorName / targetEmail / targetId in metadata
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  limit?: number;
}

/**
 * One write path for `public.audit_log`, shared by every tenant-scoped
 * module (access, employee-master, attendance, documents, …) instead of
 * each hand-rolling its own `tenantPrisma.client.auditLog.create(...)`
 * try/catch — closes the "generic audit interceptor" gap (module 12 §"Known
 * gaps") without inventing a magic auto-instrumentation layer: call sites
 * stay explicit (a mutation still says what it's logging and why), only the
 * write mechanics and error handling are centralized. A failed audit write
 * is logged and swallowed — it must never fail the business operation that
 * triggered it (same contract every existing call site already followed).
 *
 * `query()` is the cross-module read side — the module 12 "aggregation /
 * query UI" gap. Feed-specific endpoints (`GET /api/access/audit`) still
 * exist for their own narrower shapes; this is the superset view an
 * Auditor/Company Admin uses to see everything in one place.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async log(input: AuditLogInput): Promise<void> {
    try {
      await this.tenantPrisma.client.auditLog.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
          actorUserId: input.actorUserId ?? null,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId ?? null,
          ipAddress: input.ipAddress ?? null,
          metadata: input.metadata as Prisma.InputJsonObject,
        },
      });
    } catch (err) {
      this.logger.error(
        `Audit write failed for action "${input.action}" on ${input.targetType}:${input.targetId ?? '—'}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async query(filter: AuditQueryFilter): Promise<
    Array<{
      id: string;
      at: string;
      actorUserId: string | null;
      action: string;
      module: string | null;
      targetType: string;
      targetId: string | null;
      metadata: Record<string, unknown>;
    }>
  > {
    const where: Prisma.AuditLogWhereInput = {};
    if (filter.action) {
      where.action = filter.action.endsWith('.') ? { startsWith: filter.action } : filter.action;
    }
    if (filter.targetType) where.targetType = filter.targetType;

    const rows = await this.tenantPrisma.client.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filter.limit ?? 500,
    });

    let mapped = rows.map((r) => {
      const metadata = (r.metadata ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        at: r.createdAt.toISOString(),
        actorUserId: r.actorUserId,
        action: r.action,
        module: (metadata.module as string) ?? null,
        targetType: r.targetType,
        targetId: r.targetId,
        metadata,
      };
    });

    if (filter.module) mapped = mapped.filter((r) => r.module === filter.module);
    mapped = mapped.filter((r) => inDateRange(r.at, filter.from, filter.to));

    if (filter.q) {
      const q = filter.q.toLowerCase();
      mapped = mapped.filter((r) => {
        const haystack = [
          r.action,
          r.targetId ?? '',
          String(r.metadata.actorName ?? ''),
          String(r.metadata.targetEmail ?? ''),
          String(r.metadata.note ?? ''),
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    return mapped;
  }

  /** Every distinct `metadata.module` value seen — drives the frontend's module filter dropdown. */
  async modules(): Promise<string[]> {
    const rows = await this.tenantPrisma.client.auditLog.findMany({
      select: { metadata: true },
      take: 2000,
      orderBy: { createdAt: 'desc' },
    });
    const set = new Set<string>();
    for (const r of rows) {
      const m = (r.metadata as Record<string, unknown> | null)?.module;
      if (typeof m === 'string') set.add(m);
    }
    return [...set].sort();
  }
}

function inDateRange(iso: string, from?: string, to?: string): boolean {
  const day = iso.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}
