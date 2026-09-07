import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type * as admin from 'firebase-admin';
import { FIREBASE_AUTH } from '../firebase/firebase-admin.provider';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

/**
 * Firebase's ID token is the session artifact — there is no app-issued
 * JWT to mint or rotate here. `session()` just confirms the token the
 * frontend already has from Firebase (`signInWithEmailAndPassword`) maps
 * to an active user in this tenant, and returns the claims the frontend
 * needs to render (role, employeeId isn't in the token, so it's resolved
 * from the DB same as JwtAuthGuard does per-request).
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    @Inject(FIREBASE_AUTH) private readonly firebaseAuth: admin.auth.Auth,
  ) {}

  async session(idToken: string): Promise<AuthenticatedUser> {
    let decoded: admin.auth.DecodedIdToken;
    try {
      decoded = await this.firebaseAuth.verifyIdToken(idToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const tenantId = this.tenantPrisma.tenantId;
    if (decoded.tenantId !== tenantId) {
      throw new UnauthorizedException('Token was not issued for this tenant');
    }

    const user = await this.tenantPrisma.client.user.findUnique({
      where: { firebaseUid: decoded.uid },
      include: { employee: { select: { id: true } } },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account not found or inactive');
    }

    return {
      sub: user.id,
      tenantId,
      role: user.role,
      email: user.email,
      employeeId: user.employee?.id ?? null,
    };
  }
}
