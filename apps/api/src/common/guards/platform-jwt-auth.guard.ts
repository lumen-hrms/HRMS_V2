import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type * as admin from 'firebase-admin';
import { FIREBASE_AUTH } from '../../firebase/firebase-admin.provider';
import { PlatformPrismaClientProvider } from '../../prisma/platform-prisma-client.provider';
import { extractBearerToken } from './extract-bearer-token';
import type { AuthenticatedPlatformAdmin } from '../../platform-admin/platform-admin.types';

/**
 * Guards every /api/platform-admin/* route. Verifies a Firebase ID token
 * carrying the custom claim `type: 'platform_admin'` (no `tenantId` claim
 * ever set for these accounts) and rejects anything else — a tenant user's
 * token can never satisfy this guard and vice versa, mirroring the old
 * PlatformJwtStrategy's rejection logic.
 */
@Injectable()
export class PlatformJwtAuthGuard implements CanActivate {
  constructor(
    @Inject(FIREBASE_AUTH) private readonly firebaseAuth: admin.auth.Auth,
    private readonly platformPrisma: PlatformPrismaClientProvider,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedPlatformAdmin }>();
    const token = extractBearerToken(request);
    if (!token) throw new UnauthorizedException('Missing bearer token');

    let decoded: admin.auth.DecodedIdToken;
    try {
      decoded = await this.firebaseAuth.verifyIdToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (decoded.type !== 'platform_admin') {
      throw new UnauthorizedException('Not a platform admin token');
    }

    const platformAdmin = await this.platformPrisma.platformAdminUser.findUnique({
      where: { firebaseUid: decoded.uid },
    });
    if (!platformAdmin) throw new UnauthorizedException('Platform admin not found');

    request.user = { sub: platformAdmin.id, email: platformAdmin.email };
    return true;
  }
}
