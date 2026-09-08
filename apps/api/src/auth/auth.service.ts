import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type * as admin from 'firebase-admin';
import { FIREBASE_AUTH } from '../firebase/firebase-admin.provider';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

/** Where the sign-in came from — captured for the login audit trail. */
export interface SessionContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Firebase's ID token is the session artifact — there is no app-issued
 * JWT to mint or rotate here. `session()` just confirms the token the
 * frontend already has from Firebase (`signInWithEmailAndPassword`) maps
 * to an active user in this tenant, and returns the claims the frontend
 * needs to render (role, employeeId isn't in the token, so it's resolved
 * from the DB same as JwtAuthGuard does per-request).
 *
 * Every server-observed outcome — success and each failure branch — writes
 * one append-only `LoginAuditEntry` (module 01 §3 functional expectation
 * #8). BAD_CREDENTIALS never reaches here (Firebase rejects it client-side)
 * and TENANT_SUSPENDED is rejected earlier in TenantResolutionMiddleware;
 * both are documented gaps in docs/modules/01_IDENTITY_AND_ACCESS.md §9.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    @Inject(FIREBASE_AUTH) private readonly firebaseAuth: admin.auth.Auth,
  ) {}

  async session(idToken: string, ctx: SessionContext = {}): Promise<AuthenticatedUser> {
    const tenantId = this.tenantPrisma.tenantId;

    let decoded: admin.auth.DecodedIdToken;
    try {
      decoded = await this.firebaseAuth.verifyIdToken(idToken);
    } catch {
      await this.record({
        tenantId,
        email: emailFromUnverifiedToken(idToken) ?? 'unknown',
        userId: null,
        outcome: 'TOKEN_EXPIRED',
        ctx,
      });
      throw new UnauthorizedException('Invalid or expired token');
    }

    const email = (decoded.email as string | undefined) ?? 'unknown';

    if (decoded.tenantId !== tenantId) {
      await this.record({ tenantId, email, userId: null, outcome: 'CLAIM_MISMATCH', ctx });
      throw new UnauthorizedException('Token was not issued for this tenant');
    }

    const user = await this.tenantPrisma.client.user.findUnique({
      where: { firebaseUid: decoded.uid },
      include: { employee: { select: { id: true } } },
    });
    if (!user || !user.isActive) {
      await this.record({
        tenantId,
        email: user?.email ?? email,
        userId: user?.id ?? null,
        outcome: 'USER_INACTIVE',
        ctx,
      });
      throw new UnauthorizedException('Account not found or inactive');
    }

    await this.record({
      tenantId,
      email: user.email,
      userId: user.id,
      outcome: 'SUCCESS',
      ctx,
    });

    return {
      sub: user.id,
      tenantId,
      role: user.role,
      email: user.email,
      employeeId: user.employee?.id ?? null,
    };
  }

  /**
   * Append one row to the sign-in audit trail. Never throws — a failed
   * audit write must not turn a valid login into a 500, or hand an attacker
   * a way to suppress their own failure record by making the insert fail.
   */
  private async record(entry: {
    tenantId: string;
    email: string;
    userId: string | null;
    outcome: 'SUCCESS' | 'USER_INACTIVE' | 'CLAIM_MISMATCH' | 'TOKEN_EXPIRED';
    ctx: SessionContext;
  }): Promise<void> {
    try {
      await this.tenantPrisma.client.loginAuditEntry.create({
        data: {
          tenantId: entry.tenantId,
          email: entry.email,
          userId: entry.userId,
          outcome: entry.outcome,
          ipAddress: entry.ctx.ip ?? null,
          userAgent: entry.ctx.userAgent ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to write LoginAuditEntry (${entry.outcome}) for ${entry.email}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}

/**
 * Best-effort decode of a JWT's payload WITHOUT verifying its signature —
 * used only to pull an `email` for the audit row when `verifyIdToken`
 * rejected the token. The value is never trusted for anything else.
 */
function emailFromUnverifiedToken(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    const claims = JSON.parse(json) as { email?: unknown };
    return typeof claims.email === 'string' ? claims.email : null;
  } catch {
    return null;
  }
}
