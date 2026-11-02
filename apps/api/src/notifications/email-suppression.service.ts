import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteSuppressedDestinationCommand,
  NotFoundException as SesNotFoundException,
  SESv2Client,
} from '@aws-sdk/client-sesv2';
import type { EmailSuppression, EmailSuppressionReason } from '@prisma/client';
import type { AppConfig } from '../config/configuration';
import { PlatformPrismaClientProvider } from '../prisma/platform-prisma-client.provider';
import { TenantPrismaClientProvider } from '../prisma/tenant-prisma-client.provider';
import { withTenantContext } from '../prisma/with-tenant-context';
import { isSnsUrl, parseSnsMessage, SnsMessageVerifier } from './sns-message-verifier';

/** SES message tags `NotificationSendProcessor` stamps on every workflow email. */
export const TAG_TENANT_ID = 'tenant_id';
export const TAG_NOTIFICATION_ID = 'notification_id';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LIST = 500;

export type SesWebhookResult = 'subscribed' | 'bounce' | 'complaint' | 'ignored';

/** The slice of an SES event (configuration-set event publishing, or the
 *  older identity feedback notification) this handler reads. */
interface SesEvent {
  eventType?: string;
  notificationType?: string;
  mail?: { messageId?: string; tags?: Record<string, string[]> };
  bounce?: {
    bounceType?: string;
    bounceSubType?: string;
    timestamp?: string;
    bouncedRecipients?: { emailAddress?: string; diagnosticCode?: string }[];
  };
  complaint?: {
    complaintFeedbackType?: string;
    timestamp?: string;
    complainedRecipients?: { emailAddress?: string }[];
  };
}

/** Thrown by `SesEmailSender` instead of calling SES for a suppressed address. */
export class SuppressedRecipientError extends Error {
  constructor(email: string, entry: Pick<EmailSuppression, 'reason' | 'lastEventAt'>) {
    const why = entry.reason === 'BOUNCE' ? 'hard bounce' : 'spam complaint';
    super(
      `Not sent: ${email} is on the suppression list (${why} on ${entry.lastEventAt
        .toISOString()
        .slice(0, 10)}). Correct the email address, or ask the platform team to lift it.`,
    );
    this.name = 'SuppressedRecipientError';
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Module 10 §4.4 — SES bounce/complaint handling.
 *
 * SES (configuration set) → SNS topic → `POST /api/notifications/ses-events`.
 * A permanent bounce or a complaint puts the address on
 * `platform.email_suppressions`, which `SesEmailSender` checks before every
 * send. When the event carries our `tenant_id`/`notification_id` tags, a
 * bounce also flips that `notification_log` row SENT → FAILED with the
 * reason, so HR sees it in the Email log. Complaints leave the row SENT —
 * the email *was* delivered.
 */
@Injectable()
export class EmailSuppressionService {
  private readonly logger = new Logger(EmailSuppressionService.name);
  private readonly topicArn?: string;
  private readonly ses: SESv2Client;

  constructor(
    private readonly platformPrisma: PlatformPrismaClientProvider,
    private readonly tenantPrismaRaw: TenantPrismaClientProvider,
    private readonly verifier: SnsMessageVerifier,
    config: ConfigService<AppConfig, true>,
  ) {
    const ses = config.get('ses', { infer: true });
    this.topicArn = ses.eventsTopicArn;
    this.ses = new SESv2Client({ region: ses.region });
  }

  find(email: string): Promise<EmailSuppression | null> {
    return this.platformPrisma.emailSuppression.findUnique({
      where: { email: normalizeEmail(email) },
    });
  }

  /** The public webhook: authenticate the SNS envelope, then act on it. */
  async handleSnsWebhook(body: unknown): Promise<SesWebhookResult> {
    if (!this.topicArn) throw new ForbiddenException('SES event topic is not configured');
    const msg = parseSnsMessage(body);
    if (!msg) throw new BadRequestException('Not an SNS message');
    if (msg.TopicArn !== this.topicArn) throw new ForbiddenException('Unexpected SNS topic');
    if (!(await this.verifier.verify(msg))) {
      throw new ForbiddenException('Invalid SNS signature');
    }

    switch (msg.Type) {
      case 'SubscriptionConfirmation':
        if (!isSnsUrl(msg.SubscribeURL)) throw new BadRequestException('Bad SubscribeURL');
        await this.verifier.fetchText(msg.SubscribeURL!);
        this.logger.log(`Confirmed SNS subscription to ${msg.TopicArn}`);
        return 'subscribed';
      case 'Notification': {
        let event: SesEvent;
        try {
          event = JSON.parse(msg.Message) as SesEvent;
        } catch {
          return 'ignored';
        }
        return this.handleSesEvent(event);
      }
      default:
        this.logger.warn(`Ignoring SNS ${msg.Type} for ${msg.TopicArn}`);
        return 'ignored';
    }
  }

  /** Idempotent: a redelivered event re-applies the same state. */
  async handleSesEvent(event: SesEvent): Promise<SesWebhookResult> {
    const type = event.eventType ?? event.notificationType;

    if (type === 'Bounce' && event.bounce) {
      const { bounceType, bounceSubType, bouncedRecipients = [] } = event.bounce;
      const permanent = bounceType === 'Permanent';
      const at = eventTime(event.bounce.timestamp);
      const diagnostics: string[] = [];
      for (const r of bouncedRecipients) {
        if (!r.emailAddress) continue;
        const detail = [bounceSubType, r.diagnosticCode].filter(Boolean).join(': ') || null;
        if (detail) diagnostics.push(detail);
        if (permanent) await this.suppress(r.emailAddress, 'BOUNCE', detail, at);
      }
      const kind = permanent ? 'permanent' : 'temporary';
      await this.failLogRow(
        event,
        `Bounced (${kind})${diagnostics.length ? ` — ${diagnostics.join('; ')}` : ''}${
          permanent ? '. Address suppressed: correct it before retrying.' : ''
        }`,
      );
      return 'bounce';
    }

    if (type === 'Complaint' && event.complaint) {
      const at = eventTime(event.complaint.timestamp);
      const detail = event.complaint.complaintFeedbackType ?? null;
      for (const r of event.complaint.complainedRecipients ?? []) {
        if (r.emailAddress) await this.suppress(r.emailAddress, 'COMPLAINT', detail, at);
      }
      return 'complaint';
    }

    return 'ignored';
  }

  list() {
    return this.platformPrisma.emailSuppression.findMany({
      orderBy: { lastEventAt: 'desc' },
      take: MAX_LIST,
    });
  }

  /**
   * Operator action: remove from our list and (best effort) from SES's
   * account-level list — otherwise SES would keep dropping the mail itself.
   * Audited in `platform_audit_log`.
   */
  async lift(rawEmail: string, actorEmail: string) {
    const email = normalizeEmail(rawEmail);
    const entry = await this.platformPrisma.emailSuppression.findUnique({ where: { email } });
    if (!entry) throw new NotFoundException('That address is not suppressed');

    let sesListCleared = true;
    try {
      await this.ses.send(new DeleteSuppressedDestinationCommand({ EmailAddress: email }));
    } catch (err) {
      if (!(err instanceof SesNotFoundException)) {
        sesListCleared = false;
        this.logger.warn(`Could not remove ${email} from the SES suppression list: ${String(err)}`);
      }
    }

    await this.platformPrisma.$transaction([
      this.platformPrisma.emailSuppression.delete({ where: { email } }),
      this.platformPrisma.platformAuditLog.create({
        data: {
          actorEmail,
          action: 'email_suppression.lifted',
          targetType: 'email_suppression',
          targetId: email,
          metadata: {
            reason: entry.reason,
            detail: entry.detail,
            eventCount: entry.eventCount,
            sesListCleared,
          },
        },
      }),
    ]);
    return { email, sesListCleared };
  }

  private async suppress(
    rawEmail: string,
    reason: EmailSuppressionReason,
    detail: string | null,
    at: Date,
  ) {
    const email = normalizeEmail(rawEmail);
    const trimmed = detail?.slice(0, 500) ?? null;
    await this.platformPrisma.emailSuppression.upsert({
      where: { email },
      create: { email, reason, detail: trimmed, lastEventAt: at },
      update: { reason, detail: trimmed, lastEventAt: at, eventCount: { increment: 1 } },
    });
    this.logger.warn(`Suppressed ${email} after SES ${reason.toLowerCase()}`);
  }

  /**
   * Tags only come from mail we sent (the SNS topic is ours and signed), but
   * the row update still requires the SES message id to match.
   */
  private async failLogRow(event: SesEvent, lastError: string) {
    const tenantId = event.mail?.tags?.[TAG_TENANT_ID]?.[0];
    const logId = event.mail?.tags?.[TAG_NOTIFICATION_ID]?.[0];
    const messageId = event.mail?.messageId;
    if (!tenantId || !logId || !messageId || !UUID_RE.test(tenantId) || !UUID_RE.test(logId)) {
      return;
    }
    await withTenantContext(this.tenantPrismaRaw, tenantId).notificationLog.updateMany({
      where: { id: logId, providerMessageId: messageId },
      data: { status: 'FAILED', lastError: lastError.slice(0, 1000) },
    });
  }
}

function eventTime(value: string | undefined): Date {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}
