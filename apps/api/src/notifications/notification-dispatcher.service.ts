import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { NotificationTemplate, Prisma, UserRole } from '@prisma/client';
import { TenantPrismaClientProvider } from '../prisma/tenant-prisma-client.provider';
import { withTenantContext } from '../prisma/with-tenant-context';
import type { TemplateContexts } from './templates';

export const NOTIFICATIONS_QUEUE = 'notifications';

export const SEND_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 60_000 },
  // Removed either way so the sweep / a manual retry can re-add the same jobId.
  removeOnComplete: true,
  removeOnFail: true,
} as const;

export function sendJobId(logId: string) {
  return `notify-${logId}`;
}

export interface SendJobData {
  tenantId: string;
  logId: string;
}

/** Who should get it. Any mix; resolved to active users with an email. */
export interface Recipients {
  userIds?: (string | null | undefined)[];
  employeeIds?: (string | null | undefined)[];
  roles?: UserRole[];
}

export interface NotifyInput<T extends keyof TemplateContexts> {
  tenantId: string;
  template: T & NotificationTemplate;
  context: TemplateContexts[T];
  /** Stable per event, e.g. `leave:<id>:decided:APPROVED` (RULE-3). */
  dedupeKey: string;
  to: Recipients;
  /** The user who caused the event — never emailed about their own action. */
  actorUserId?: string | null;
}

export const HR_ROLES: UserRole[] = ['COMPANY_ADMIN', 'HR_MANAGER'];

/**
 * Module 10 entry point (docs/modules/10_NOTIFICATIONS.md §3.1). A
 * singleton, not request-scoped, so request handlers *and* BullMQ
 * processors call it the same way with an explicit `tenantId`; every query
 * runs through `withTenantContext` on the NOBYPASSRLS `hrms_app` role.
 *
 * `notify()` never throws (RULE-2): it runs after the caller's state change
 * has committed, and a mail problem must not turn a successful approval
 * into a 500. Anything written but not enqueued is picked up by the sweep.
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    private readonly tenantPrismaRaw: TenantPrismaClientProvider,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  async notify<T extends keyof TemplateContexts>(input: NotifyInput<T>): Promise<void> {
    try {
      await this.notifyOrThrow(input);
    } catch (err) {
      this.logger.warn(
        `Could not queue ${input.template} (${input.dedupeKey}) for tenant ${input.tenantId}: ${String(err)}`,
      );
    }
  }

  private async notifyOrThrow<T extends keyof TemplateContexts>(input: NotifyInput<T>) {
    const client = withTenantContext(this.tenantPrismaRaw, input.tenantId);
    const recipients = await this.resolve(client, input.to, input.actorUserId ?? null);
    if (recipients.length === 0) return;

    await client.notificationLog.createMany({
      data: recipients.map((r) => ({
        tenantId: input.tenantId,
        template: input.template,
        recipientUserId: r.id,
        recipientEmail: r.email,
        context: input.context as unknown as Prisma.InputJsonValue,
        dedupeKey: input.dedupeKey,
      })),
      skipDuplicates: true,
    });

    const rows = await client.notificationLog.findMany({
      where: {
        dedupeKey: input.dedupeKey,
        status: 'QUEUED',
        recipientUserId: { in: recipients.map((r) => r.id) },
      },
      select: { id: true },
    });
    for (const row of rows) await this.enqueue(input.tenantId, row.id);
  }

  async enqueue(tenantId: string, logId: string) {
    await this.queue.add('send', { tenantId, logId } satisfies SendJobData, {
      ...SEND_JOB_OPTIONS,
      jobId: sendJobId(logId),
    });
  }

  /** RULE-4: active users with an email, this tenant only (RLS), minus the actor. */
  private async resolve(
    client: ReturnType<typeof withTenantContext>,
    to: Recipients,
    actorUserId: string | null,
  ) {
    const userIds = (to.userIds ?? []).filter((id): id is string => !!id);
    const employeeIds = (to.employeeIds ?? []).filter((id): id is string => !!id);
    const roles = to.roles ?? [];
    const or: Prisma.UserWhereInput[] = [];
    if (userIds.length) or.push({ id: { in: userIds } });
    if (employeeIds.length) or.push({ employee: { is: { id: { in: employeeIds } } } });
    if (roles.length) or.push({ role: { in: roles } });
    if (or.length === 0) return [];

    const users = await client.user.findMany({
      where: { isActive: true, OR: or },
      select: { id: true, email: true },
    });
    return users.filter((u) => u.email && u.id !== actorUserId);
  }
}
