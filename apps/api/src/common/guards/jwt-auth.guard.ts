import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type * as admin from 'firebase-admin';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { FIREBASE_AUTH } from '../../firebase/firebase-admin.provider';
import { TenantPrismaClientProvider } from '../../prisma/tenant-prisma-client.provider';
import { withTenantContext } from '../../prisma/with-tenant-context';
import { extractBearerToken } from './extract-bearer-token';
import {
  authUserByUid,
  setupCompleteByTenant,
  type CachedAuthUser,
} from '../tenancy/auth-context-cache';

/**
 * Verifies a Firebase ID token (kept the name `JwtAuthGuard` so every
 * feature controller's `@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)`
 * chain needs no changes — only what's inside "prove who you are" moved).
 *
 * `tenantId` and `role` come straight off the token's custom claims (set
 * server-side via the Admin SDK whenever a user is created or their role
 * changes — see PlatformAdminService). `employeeId` isn't a claim, so it's
 * hydrated with one scoped DB lookup by `firebaseUid`, same shape as the
 * old JWT's embedded `employeeId` but resolved per-request instead of at
 * token-issuance time (Firebase issues/refreshes tokens, not us).
 *
 * Both lookups are cached ~30 s and cleared on any user / login-link write
 * (see auth-context-cache.ts), so most requests skip the DB here entirely.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(FIREBASE_AUTH) private readonly firebaseAuth: admin.auth.Auth,
    private readonly tenantPrismaRaw: TenantPrismaClientProvider,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser; setupComplete?: boolean }>();
    const token = extractBearerToken(request);
    if (!token) throw new UnauthorizedException('Missing bearer token');

    let decoded: admin.auth.DecodedIdToken;
    try {
      decoded = await this.firebaseAuth.verifyIdToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const tenantId = decoded.tenantId as string | undefined;
    const role = decoded.role as string | undefined;
    if (!tenantId || !role) {
      throw new UnauthorizedException('Token missing tenant/role claims');
    }

    const userKey = `${tenantId}:${decoded.uid}`;
    const [user, setupComplete] = await Promise.all([
      authUserByUid.get(userKey) ?? this.loadUser(tenantId, decoded.uid, userKey),
      // Company setup status, for TenantGuard's setup gate — read here so a
      // request costs one more indexed lookup, not another guard round-trip.
      setupCompleteByTenant.get(tenantId) ?? this.loadSetupComplete(tenantId),
    ]);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account not found or inactive');
    }

    request.setupComplete = setupComplete;
    request.user = {
      sub: user.id,
      tenantId,
      role: user.role,
      email: user.email,
      employeeId: user.employeeId,
    };
    return true;
  }

  private async loadUser(
    tenantId: string,
    firebaseUid: string,
    key: string,
  ): Promise<CachedAuthUser | null> {
    const row = await withTenantContext(this.tenantPrismaRaw, tenantId).user.findUnique({
      where: { firebaseUid },
      include: { employee: { select: { id: true } } },
    });
    if (!row) return null;
    const user = {
      id: row.id,
      role: row.role,
      email: row.email,
      isActive: row.isActive,
      employeeId: row.employee?.id ?? null,
    };
    authUserByUid.set(key, user);
    return user;
  }

  /** Only a finished setup is cached — it never un-finishes. */
  private async loadSetupComplete(tenantId: string): Promise<boolean> {
    const setup = await withTenantContext(this.tenantPrismaRaw, tenantId).tenantSetup.findUnique({
      where: { tenantId },
      select: { completedAt: true },
    });
    if (setup?.completedAt) setupCompleteByTenant.set(tenantId, true);
    return !!setup?.completedAt;
  }
}
