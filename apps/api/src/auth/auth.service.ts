import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import type { AppConfig } from '../config/configuration';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { MfaService } from './mfa.service';

const MFA_REQUIRED_ROLES = ['COMPANY_ADMIN', 'HR_MANAGER'];
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 30;
const BCRYPT_COST = 12;

export interface LoginResult {
  status: 'ok' | 'mfa_required' | 'mfa_enrollment_required';
  accessToken?: string;
  refreshToken?: string;
  mfaChallengeToken?: string;
  qrCodeDataUrl?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly mfa: MfaService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const tenantId = this.tenantPrisma.tenantId;
    const user = await this.tenantPrisma.client.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
    });

    // Constant-shape response whether the user exists or not, to avoid
    // leaking account existence — but we still need to run a bcrypt compare
    // either way to keep timing roughly constant.
    const passwordHash = user?.passwordHash ?? '$2b$12$invalidsaltinvalidsaltinvalidsaltinvOe';

    if (user && user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException(
        `Account locked until ${user.lockedUntil.toISOString()} due to repeated failed logins`,
      );
    }
    if (user && !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordOk = await bcrypt.compare(password, passwordHash);

    if (!user || !passwordOk) {
      if (user) await this.registerFailedAttempt(user.id, user.failedLoginCount);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Successful password check resets the failure counter.
    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await this.tenantPrisma.client.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }

    if (MFA_REQUIRED_ROLES.includes(user.role)) {
      if (!user.mfaEnabled) {
        const secret = this.mfa.generateSecret();
        const qrCodeDataUrl = await this.mfa.generateQrCodeDataUrl(user.email, secret);
        const mfaChallengeToken = this.jwt.sign(
          { sub: user.id, tenantId, type: 'mfa_enroll', secret },
          { secret: this.config.get('jwt.accessSecret', { infer: true }), expiresIn: '10m' },
        );
        return { status: 'mfa_enrollment_required', mfaChallengeToken, qrCodeDataUrl };
      }

      const mfaChallengeToken = this.jwt.sign(
        { sub: user.id, tenantId, type: 'mfa_verify' },
        { secret: this.config.get('jwt.accessSecret', { infer: true }), expiresIn: '10m' },
      );
      return { status: 'mfa_required', mfaChallengeToken };
    }

    const tokens = await this.issueTokens(user.id, tenantId, user.role, user.email);
    return { status: 'ok', ...tokens };
  }

  async verifyMfaAndIssueTokens(mfaChallengeToken: string, code: string): Promise<LoginResult> {
    const payload = this.decodeChallenge(mfaChallengeToken, 'mfa_verify');
    const tenantId = this.tenantPrisma.tenantId;
    if (payload.tenantId !== tenantId) throw new ForbiddenException('Tenant mismatch');

    const user = await this.tenantPrisma.client.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.mfaSecret) throw new UnauthorizedException('MFA not configured');

    if (!this.mfa.verifyToken(code, user.mfaSecret)) {
      throw new UnauthorizedException('Invalid MFA code');
    }

    const tokens = await this.issueTokens(user.id, tenantId, user.role, user.email);
    return { status: 'ok', ...tokens };
  }

  async completeMfaEnrollment(mfaChallengeToken: string, code: string): Promise<LoginResult> {
    const payload = this.decodeChallenge(mfaChallengeToken, 'mfa_enroll');
    const tenantId = this.tenantPrisma.tenantId;
    if (payload.tenantId !== tenantId) throw new ForbiddenException('Tenant mismatch');

    const secret = payload.secret as string;
    if (!this.mfa.verifyToken(code, secret)) {
      throw new UnauthorizedException('Invalid MFA code');
    }

    const user = await this.tenantPrisma.client.user.update({
      where: { id: payload.sub },
      data: { mfaEnabled: true, mfaSecret: secret },
    });

    const tokens = await this.issueTokens(user.id, tenantId, user.role, user.email);
    return { status: 'ok', ...tokens };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    let payload: { sub: string; tenantId: string };
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: this.config.get('jwt.refreshSecret', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tenantId = this.tenantPrisma.tenantId;
    if (payload.tenantId !== tenantId) throw new ForbiddenException('Tenant mismatch');

    const user = await this.tenantPrisma.client.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.refreshTokenHash) throw new UnauthorizedException('Session revoked');

    const hash = this.hashRefreshToken(refreshToken);
    if (hash !== user.refreshTokenHash) {
      // Reuse of a rotated-out refresh token — revoke the session entirely.
      await this.tenantPrisma.client.user.update({
        where: { id: user.id },
        data: { refreshTokenHash: null },
      });
      throw new UnauthorizedException('Refresh token reuse detected, session revoked');
    }

    return this.issueTokens(user.id, tenantId, user.role, user.email);
  }

  async logout(userId: string) {
    const tenantId = this.tenantPrisma.tenantId;
    await this.tenantPrisma.client.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null },
    });
    void tenantId;
  }

  private decodeChallenge(token: string, expectedType: string) {
    let payload: { sub: string; tenantId: string; type: string; secret?: string };
    try {
      payload = this.jwt.verify(token, {
        secret: this.config.get('jwt.accessSecret', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA challenge');
    }
    if (payload.type !== expectedType) {
      throw new UnauthorizedException('Invalid MFA challenge type');
    }
    return payload;
  }

  private async registerFailedAttempt(userId: string, currentCount: number) {
    const nextCount = currentCount + 1;
    const data: { failedLoginCount: number; lockedUntil?: Date } = {
      failedLoginCount: nextCount,
    };
    if (nextCount >= MAX_FAILED_ATTEMPTS) {
      data.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
    }
    await this.tenantPrisma.client.user.update({ where: { id: userId }, data });
  }

  private async issueTokens(userId: string, tenantId: string, role: string, email: string) {
    const accessToken = this.jwt.sign(
      { sub: userId, tenantId, role, email },
      {
        secret: this.config.get('jwt.accessSecret', { infer: true }),
        expiresIn: this.config.get('jwt.accessTtl', { infer: true }),
      },
    );
    const refreshToken = this.jwt.sign(
      { sub: userId, tenantId, jti: crypto.randomUUID() },
      {
        secret: this.config.get('jwt.refreshSecret', { infer: true }),
        expiresIn: this.config.get('jwt.refreshTtl', { infer: true }),
      },
    );
    await this.tenantPrisma.client.user.update({
      where: { id: userId },
      data: { refreshTokenHash: this.hashRefreshToken(refreshToken) },
    });
    return { accessToken, refreshToken };
  }

  static hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_COST);
  }

  private hashRefreshToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
