import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PlatformPrismaClientProvider } from '../prisma/platform-prisma-client.provider';
import { RazorpayClient, verifyWebhookSignature } from './razorpay.client';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Days a tenant keeps full access after a failed charge before going read-only. */
export const GRACE_DAYS = 7;
/** Monthly charges Razorpay will attempt before the subscription completes (10 years). */
const TOTAL_COUNT = 120;

interface RazorpayEvent {
  event: string;
  payload?: {
    subscription?: { entity?: { id: string; current_end?: number | null } };
    payment?: {
      entity?: { id: string; amount: number; currency?: string; created_at?: number };
    };
  };
}

export type WebhookResult = 'applied' | 'duplicate' | 'ignored';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly platformPrisma: PlatformPrismaClientProvider,
    private readonly razorpay: RazorpayClient,
  ) {}

  /**
   * Operator action: create the tenant's Razorpay subscription and return the
   * hosted payment link to send to the customer. The tenant stays as it is
   * until Razorpay reports the first successful charge via webhook.
   */
  async subscribeTenant(tenantId: string, actorEmail?: string) {
    const sub = await this.platformPrisma.subscription.findUnique({
      where: { tenantId },
      include: { tenant: { select: { name: true } } },
    });
    if (!sub) throw new NotFoundException('Tenant has no subscription');
    if (sub.razorpaySubscriptionId) {
      throw new BadRequestException('This tenant already has a Razorpay subscription.');
    }
    const rate = sub.pricePerSeat ? Number(sub.pricePerSeat) : 0;
    const amountPaise = Math.round(rate * sub.seats * 100);
    if (amountPaise <= 0) {
      throw new BadRequestException('Set a price per seat above zero (Adjust pricing) first.');
    }

    const plan = await this.razorpay.createPlan({
      name: `${sub.tenant.name} — ${sub.plan} (${sub.seats} seats)`,
      amountPaise,
    });
    const created = await this.razorpay.createSubscription({
      planId: plan.id,
      tenantId,
      totalCount: TOTAL_COUNT,
    });
    await this.platformPrisma.subscription.update({
      where: { tenantId },
      data: { razorpaySubscriptionId: created.id },
    });
    await this.audit('billing.subscription_created', tenantId, actorEmail ?? 'unknown', {
      razorpaySubscriptionId: created.id,
      monthlyAmount: (amountPaise / 100).toFixed(2),
    });
    return { subscriptionId: created.id, paymentUrl: created.short_url };
  }

  /** Newest first; amounts as strings (Decimal). */
  async listPayments(tenantId: string) {
    const rows = await this.platformPrisma.payment.findMany({
      where: { tenantId },
      orderBy: { paidAt: 'desc' },
      take: 100,
    });
    return rows.map((p) => ({
      id: p.id,
      razorpayPaymentId: p.razorpayPaymentId,
      amount: p.amount.toString(),
      currency: p.currency,
      paidAt: p.paidAt.toISOString(),
      periodEnd: p.periodEnd?.toISOString() ?? null,
    }));
  }

  /**
   * Public webhook entry. Authenticity first (signature over the raw bytes),
   * then each event id is applied at most once: the ledger insert and the
   * state change share one transaction, so a failure rolls both back and
   * Razorpay's retry re-applies it.
   */
  async handleWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    eventIdHeader: string | undefined,
  ): Promise<WebhookResult> {
    const secret = this.razorpay.webhookSecret;
    if (!secret) throw new UnauthorizedException('Webhook secret is not configured');
    if (!rawBody || !signature || !verifyWebhookSignature(rawBody, signature, secret)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    let event: RazorpayEvent;
    try {
      event = JSON.parse(rawBody.toString('utf8')) as RazorpayEvent;
    } catch {
      throw new BadRequestException('Malformed webhook body');
    }
    const eventId = eventIdHeader || `${event.event}:${signature}`;
    const subscriptionId = event.payload?.subscription?.entity?.id;
    if (!subscriptionId) return 'ignored';

    return this.platformPrisma.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({
        where: { razorpaySubscriptionId: subscriptionId },
        include: { tenant: { select: { id: true, status: true } } },
      });
      if (!sub) {
        this.logger.warn(`Webhook ${event.event} for unknown subscription ${subscriptionId}`);
        return 'ignored';
      }

      try {
        await tx.billingEvent.create({
          data: { eventId, type: event.event, tenantId: sub.tenantId },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return 'duplicate';
        }
        throw err;
      }

      const tenantId = sub.tenantId;
      const status = sub.tenant.status;
      // SUSPENDED is an operator decision; a payment event never overrides it.
      const canReactivate = status === 'TRIAL' || status === 'READ_ONLY';
      const canRestrict = status === 'TRIAL' || status === 'ACTIVE';
      const record = (action: string, metadata: Record<string, unknown>) =>
        tx.platformAuditLog.create({
          data: {
            actorEmail: 'system:razorpay',
            action,
            targetType: 'tenant',
            targetId: tenantId,
            metadata: metadata as Prisma.InputJsonValue,
          },
        });

      switch (event.event) {
        case 'subscription.activated':
        case 'subscription.charged': {
          const payment = event.payload?.payment?.entity;
          const currentEnd = event.payload?.subscription?.entity?.current_end;
          const paidAt = payment?.created_at ? new Date(payment.created_at * 1000) : new Date();
          const periodEnd = currentEnd ? new Date(currentEnd * 1000) : null;
          if (event.event === 'subscription.charged' && payment) {
            await tx.payment.create({
              data: {
                tenantId,
                razorpayPaymentId: payment.id,
                razorpaySubscriptionId: subscriptionId,
                amount: new Prisma.Decimal(payment.amount).div(100),
                currency: payment.currency ?? 'INR',
                paidAt,
                periodEnd,
              },
            });
          }
          await tx.subscription.update({
            where: { tenantId },
            data: {
              trialEndsAt: null,
              graceEndsAt: null,
              ...(periodEnd ? { renewsAt: periodEnd } : {}),
            },
          });
          if (canReactivate) {
            await tx.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });
          }
          await record(
            event.event === 'subscription.charged'
              ? 'billing.payment_received'
              : 'billing.activated',
            { paymentId: payment?.id ?? null, previousStatus: status },
          );
          return 'applied';
        }
        case 'subscription.pending': {
          // A charge failed; Razorpay will retry. Start (don't extend) the grace window.
          if (!sub.graceEndsAt) {
            const graceEndsAt = new Date(Date.now() + GRACE_DAYS * DAY_MS);
            await tx.subscription.update({ where: { tenantId }, data: { graceEndsAt } });
            await record('billing.payment_failed', { graceEndsAt: graceEndsAt.toISOString() });
          }
          return 'applied';
        }
        case 'subscription.halted':
        case 'subscription.cancelled': {
          // Retries exhausted, or billing was cancelled: stop full access.
          if (canRestrict) {
            await tx.tenant.update({ where: { id: tenantId }, data: { status: 'READ_ONLY' } });
          }
          await record(
            event.event === 'subscription.halted' ? 'billing.halted' : 'billing.cancelled',
            { previousStatus: status },
          );
          return 'applied';
        }
        default:
          return 'ignored';
      }
    });
  }

  /** Daily job: ACTIVE tenants whose grace window has passed go READ_ONLY. */
  async enforceGrace(now: Date = new Date()): Promise<number> {
    const overdue = await this.platformPrisma.tenant.findMany({
      where: { status: 'ACTIVE', subscription: { is: { graceEndsAt: { lte: now } } } },
      select: { id: true },
    });
    for (const t of overdue) {
      await this.platformPrisma.tenant.update({
        where: { id: t.id },
        data: { status: 'READ_ONLY' },
      });
      await this.audit('billing.grace_expired', t.id, 'system:billing', {});
    }
    return overdue.length;
  }

  private async audit(
    action: string,
    tenantId: string,
    actorEmail: string,
    metadata: Record<string, unknown>,
  ) {
    try {
      await this.platformPrisma.platformAuditLog.create({
        data: {
          actorEmail,
          action,
          targetType: 'tenant',
          targetId: tenantId,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
    } catch {
      // best-effort — the change itself already succeeded.
    }
  }
}
