import { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Prints one readable INFO line for every audit row written, in both
 * schemas — the business events ("tenant.status_changed", "user.deactivated",
 * "employee.updated", ...), since every module that changes something
 * important already records it there:
 *
 *   INFO --- [Audit] : tenant.status_changed tenant:3f2c… by ops@hrms.dev (tenantName=Acme, from=ACTIVE, to=SUSPENDED)
 *   INFO --- [Audit] : sign-in SUCCESS for hr@acme.test
 *
 * Only an allow-list of metadata keys is printed — audit metadata can carry
 * before/after values of sensitive fields (salary, bank), which must not
 * end up in plain-text logs.
 */
const logger = new Logger('Audit');

const SAFE_KEYS = ['tenantName', 'actorRole', 'fieldsChanged', 'role', 'status'] as const;
/** `from`/`to` hold statuses or roles for these actions, never field values. */
const STATUS_ACTIONS = /^(tenant\.|subscription\.|user\.|access\.)/;

type AuditData = {
  action?: string;
  targetType?: string;
  targetId?: string | null;
  actorEmail?: string;
  metadata?: Record<string, unknown> | null;
};

export function describeAuditEvent(data: AuditData): string {
  const meta = data.metadata ?? {};
  const actor =
    data.actorEmail ?? (typeof meta.actorName === 'string' ? meta.actorName : undefined);
  const details: string[] = [];
  for (const key of SAFE_KEYS) {
    const v = meta[key];
    if (Array.isArray(v) && v.length) details.push(`${key}=${v.join(', ')}`);
    else if (typeof v === 'string' || typeof v === 'number') details.push(`${key}=${v}`);
  }
  if (data.action && STATUS_ACTIONS.test(data.action)) {
    for (const key of ['from', 'to'] as const) {
      const v = meta[key];
      if (typeof v === 'string' && v.length <= 40) details.push(`${key}=${v}`);
    }
  }
  return (
    `${data.action} ${data.targetType}${data.targetId ? `:${data.targetId}` : ''}` +
    `${actor ? ` by ${actor}` : ''}${details.length ? ` (${details.join(', ')})` : ''}`
  );
}

export function logAuditWrites(): Prisma.Middleware {
  return async (params, next) => {
    const result = await next(params);
    try {
      if (params.model === 'AuditLog' || params.model === 'PlatformAuditLog') {
        if (params.action === 'create') logger.log(describeAuditEvent(params.args?.data ?? {}));
        if (params.action === 'createMany') {
          const rows = ([] as AuditData[]).concat(params.args?.data ?? []);
          const actions = [...new Set(rows.map((r) => r.action))].join(', ');
          logger.log(`${rows.length} × ${actions}`);
        }
      }
      if (params.model === 'LoginAuditEntry' && params.action === 'create') {
        const d = params.args?.data ?? {};
        logger.log(`sign-in ${d.outcome} for ${d.email}`);
      }
    } catch {
      // Logging must never break the write that already succeeded.
    }
    return result;
  };
}
