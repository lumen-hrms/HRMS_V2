import { Injectable } from '@nestjs/common';
import { PlatformPrismaClientProvider } from '../prisma/platform-prisma-client.provider';

export interface WorkspaceStatus {
  status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL' | 'READ_ONLY';
  /** End of the trial window (TRIAL only). */
  trialEndsAt: string | null;
  /** When read-only starts after a failed payment (ACTIVE only). */
  graceEndsAt: string | null;
}

/** What the in-app banner needs: commercial state only, no billing detail. */
@Injectable()
export class WorkspaceStatusService {
  constructor(private readonly platformPrisma: PlatformPrismaClientProvider) {}

  async get(tenantId: string): Promise<WorkspaceStatus> {
    const tenant = await this.platformPrisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        status: true,
        subscription: { select: { trialEndsAt: true, graceEndsAt: true } },
      },
    });
    const sub = tenant?.subscription;
    return {
      status: tenant?.status ?? 'ACTIVE',
      trialEndsAt: tenant?.status === 'TRIAL' ? (sub?.trialEndsAt?.toISOString() ?? null) : null,
      graceEndsAt: tenant?.status === 'ACTIVE' ? (sub?.graceEndsAt?.toISOString() ?? null) : null,
    };
  }
}
