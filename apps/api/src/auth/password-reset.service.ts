import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuthEmailService } from '../notifications/auth-email.service';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_EMAIL = 3;
const MAX_PER_IP = 10;

/**
 * Fixed-window counter, in memory. Enough for the single-instance API we run
 * today; move it to Redis if the API is ever scaled horizontally.
 */
export class WindowLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Records a hit; false once `key` is over the limit for this window. */
  take(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 10_000) this.prune(now);
      return true;
    }
    entry.count += 1;
    return entry.count <= this.max;
  }

  private prune(now: number) {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}

/**
 * The per-email / per-IP counters. Its own provider so it stays a
 * singleton: `PasswordResetService` depends on the request-scoped
 * `TenantPrismaService` and is therefore re-created per request — limiters
 * living on it would reset on every call and never limit anything.
 */
@Injectable()
export class PasswordResetLimiter {
  readonly perEmail = new WindowLimiter(MAX_PER_EMAIL, WINDOW_MS);
  readonly perIp = new WindowLimiter(MAX_PER_IP, WINDOW_MS);
}

/**
 * Self-service "Forgot password?" for tenant users (module 10 auth emails).
 * Replaces the browser calling Firebase's `sendPasswordResetEmail`, so the
 * email comes from the workspace's domain via SES instead of Firebase.
 *
 * Never reveals whether an account exists: unknown, inactive and
 * over-the-per-email-limit requests all get the same response as a real
 * send. Only the per-IP limit answers differently (429) — that says nothing
 * about any account.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly authEmails: AuthEmailService,
    private readonly limiter: PasswordResetLimiter,
  ) {}

  async request(rawEmail: string, ip: string | undefined): Promise<void> {
    const tenantId = this.tenantPrisma.tenantId;
    if (!this.limiter.perIp.take(`${tenantId}:${ip ?? 'unknown'}`)) {
      throw new HttpException(
        'Too many reset requests. Please wait a few minutes and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const email = rawEmail.trim().toLowerCase();
    if (!this.limiter.perEmail.take(`${tenantId}:${email}`)) return;

    const user = await this.tenantPrisma.client.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, isActive: true },
      select: { email: true },
    });
    if (!user) return;

    try {
      await this.authEmails.sendPasswordReset({
        email: user.email,
        kind: 'SELF_SERVICE',
        tenantId,
      });
    } catch (err) {
      // Same response either way (see class doc) — the operator finds out here.
      this.logger.error(
        `Self-service reset email to ${user.email} (tenant ${tenantId}) failed`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
