import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import type { TenantPrismaService } from '../prisma/tenant-prisma.service';

/**
 * Append-only audit row for a payroll change. Metadata deliberately carries
 * no compensation amounts (module 07 §12 decision 9: the Auditor gets no
 * per-employee pay drill-down), only what changed structurally.
 */
export async function writePayrollAudit(
  tenantPrisma: TenantPrismaService,
  user: AuthenticatedUser,
  action: string,
  targetType: string,
  targetId: string | undefined,
  metadata: Record<string, unknown>,
) {
  await tenantPrisma.client.auditLog
    .create({
      data: {
        tenantId: tenantPrisma.tenantId,
        actorUserId: user.sub,
        action,
        targetType,
        targetId,
        metadata: { module: 'payroll', ...metadata },
      },
    })
    .catch(() => undefined);
}
