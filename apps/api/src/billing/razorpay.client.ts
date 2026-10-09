import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { AppConfig } from '../config/configuration';

const API = 'https://api.razorpay.com/v1';

/** `X-Razorpay-Signature` = hex HMAC-SHA256 of the exact raw body with the webhook secret. */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Thin REST wrapper (no SDK dependency — same approach as the clamd client). */
@Injectable()
export class RazorpayClient {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  get webhookSecret(): string | undefined {
    return this.config.get('razorpay', { infer: true }).webhookSecret;
  }

  get isConfigured(): boolean {
    const r = this.config.get('razorpay', { infer: true });
    return !!(r.keyId && r.keySecret);
  }

  private async call<T>(path: string, body: unknown): Promise<T> {
    const r = this.config.get('razorpay', { infer: true });
    if (!r.keyId || !r.keySecret) {
      throw new ServiceUnavailableException(
        'Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)',
      );
    }
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${r.keyId}:${r.keySecret}`).toString('base64')}`,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { description?: string } };
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `Razorpay rejected the request: ${json.error?.description ?? res.status}`,
      );
    }
    return json as T;
  }

  /** A monthly plan priced for exactly this tenant (negotiated rate × seats). */
  createPlan(input: { name: string; amountPaise: number }) {
    return this.call<{ id: string }>('/plans', {
      period: 'monthly',
      interval: 1,
      item: { name: input.name, amount: input.amountPaise, currency: 'INR' },
    });
  }

  createSubscription(input: { planId: string; tenantId: string; totalCount: number }) {
    return this.call<{ id: string; short_url: string }>('/subscriptions', {
      plan_id: input.planId,
      total_count: input.totalCount,
      customer_notify: 1,
      notes: { tenantId: input.tenantId },
    });
  }
}
