import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { TenantPrismaClientProvider } from '../prisma/tenant-prisma-client.provider';
import { withTenantContext } from '../prisma/with-tenant-context';
import { LEAVE_QUEUE } from './leave.constants';
import { HR_ROLES, NotificationDispatcher } from '../notifications/notification-dispatcher.service';
import { leaveNotificationContext } from './leave-notifications';

interface EscalationJobData {
  tenantId: string;
  leaveRequestId: string;
  level: 1 | 2;
}

/**
 * Fires `escalationDays` after a request enters a pending level. No-ops if
 * the request has since been decided/cancelled. Level 1 auto-advances to
 * L2 (mirrors the manual approve() transition) and re-arms itself for L2;
 * level 2 has no higher approver in V1, so it only logs a flag for HR to
 * follow up manually — a balance deduction is never auto-approved.
 */
@Injectable()
@Processor(LEAVE_QUEUE)
export class LeaveEscalationProcessor extends WorkerHost {
  constructor(
    private readonly tenantPrismaRaw: TenantPrismaClientProvider,
    @InjectQueue(LEAVE_QUEUE) private readonly leaveQueue: Queue,
    private readonly notifications: NotificationDispatcher,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== 'escalate') return;
    const { tenantId, leaveRequestId, level } = job.data as EscalationJobData;
    const client = withTenantContext(this.tenantPrismaRaw, tenantId);

    const req = await client.leaveRequest.findUnique({
      where: { id: leaveRequestId },
      include: { employee: true, leaveType: true },
    });
    const expectedStatus = level === 1 ? 'PENDING_L1' : 'PENDING_L2';
    if (!req || req.status !== expectedStatus) return;

    if (level === 1) {
      await client.leaveRequest.update({
        where: { id: leaveRequestId },
        data: { status: 'PENDING_L2' },
      });
      await client.leaveApproval.create({
        data: {
          tenantId,
          leaveRequestId,
          level: 1,
          approverId: null,
          decision: 'ESCALATED',
          comment: 'Auto-escalated — no decision within the tenant’s escalation window',
        },
      });
      const settings = await client.tenantSettings.findUniqueOrThrow({ where: { tenantId } });
      await this.leaveQueue.add(
        'escalate',
        { tenantId, leaveRequestId, level: 2 },
        {
          delay: settings.leaveEscalationDays * 24 * 60 * 60 * 1000,
          jobId: `escalate:${leaveRequestId}:2`,
        },
      );
      // Same dedupe key as a manual L1 approval — HR hears once either way.
      await this.notifications.notify({
        tenantId,
        template: 'LEAVE_PENDING_APPROVAL',
        context: { ...leaveNotificationContext(req), level: 2, escalated: true },
        dedupeKey: `leave:${leaveRequestId}:pending:L2`,
        to: { roles: HR_ROLES },
      });
      return;
    }

    await client.leaveApproval.create({
      data: {
        tenantId,
        leaveRequestId,
        level: 2,
        approverId: null,
        decision: 'ESCALATED',
        comment: 'Escalation threshold reached at final approval — needs manual HR follow-up',
      },
    });
    await this.notifications.notify({
      tenantId,
      template: 'LEAVE_ESCALATED',
      context: leaveNotificationContext(req),
      dedupeKey: `leave:${leaveRequestId}:escalated:L2`,
      to: { roles: HR_ROLES },
    });
  }
}
