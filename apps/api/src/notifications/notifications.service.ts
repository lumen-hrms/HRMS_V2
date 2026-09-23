import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NotificationLog, NotificationStatus } from '@prisma/client';
import type { AppConfig } from '../config/configuration';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { NotificationDispatcher } from './notification-dispatcher.service';
import { render } from './templates';

const STATUSES: NotificationStatus[] = ['QUEUED', 'SENT', 'FAILED'];
const MAX_LIMIT = 200;

/** Email log read + retry (module 10 §3.3) — request-scoped, RLS via TenantPrismaService. */
@Injectable()
export class NotificationsService {
  private readonly appBaseUrl: string;

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly dispatcher: NotificationDispatcher,
    config: ConfigService<AppConfig, true>,
  ) {
    this.appBaseUrl = config.get('appBaseUrl', { infer: true });
  }

  async list(filter: { status?: string; limit?: string }) {
    const status = STATUSES.find((s) => s === filter.status);
    const limit = Math.min(Math.max(parseInt(filter.limit ?? '100', 10) || 100, 1), MAX_LIMIT);
    const [rows, counts] = await Promise.all([
      this.tenantPrisma.client.notificationLog.findMany({
        where: status ? { status } : {},
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.tenantPrisma.client.notificationLog.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);
    return {
      counts: Object.fromEntries(
        STATUSES.map((s) => [s, counts.find((c) => c.status === s)?._count._all ?? 0]),
      ) as Record<NotificationStatus, number>,
      items: rows.map((r) => this.toDto(r)),
    };
  }

  /** FAILED → QUEUED + re-enqueued; audited. Only failed rows — a SENT email is never re-sent. */
  async retry(id: string, actor: AuthenticatedUser) {
    const row = await this.tenantPrisma.client.notificationLog.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Notification not found');
    if (row.status !== 'FAILED') {
      throw new BadRequestException(
        `Only failed emails can be retried (this one is ${row.status})`,
      );
    }
    const updated = await this.tenantPrisma.client.notificationLog.update({
      where: { id },
      data: { status: 'QUEUED' },
    });
    await this.tenantPrisma.client.auditLog.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        actorUserId: actor.sub,
        action: 'notifications.retried',
        targetType: 'notification',
        targetId: id,
        metadata: {
          module: 'notifications',
          template: row.template,
          recipientEmail: row.recipientEmail,
          lastError: row.lastError,
        },
      },
    });
    // If Redis is down the row stays QUEUED and the sweep sends it later.
    await this.dispatcher.enqueue(this.tenantPrisma.tenantId, id).catch(() => undefined);
    return this.toDto(updated);
  }

  private toDto(row: NotificationLog) {
    let subject: string;
    try {
      subject = render(row.template, row.context, {
        appBaseUrl: this.appBaseUrl,
        tenantName: '',
      }).subject;
    } catch {
      subject = row.template;
    }
    return {
      id: row.id,
      template: row.template,
      subject,
      recipientEmail: row.recipientEmail,
      status: row.status,
      attempts: row.attempts,
      lastError: row.lastError,
      createdAt: row.createdAt,
      sentAt: row.sentAt,
    };
  }
}
