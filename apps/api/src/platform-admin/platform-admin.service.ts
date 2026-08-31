import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PlatformPrismaClientProvider } from '../prisma/platform-prisma-client.provider';
import { TenantPrismaClientProvider } from '../prisma/tenant-prisma-client.provider';
import { withTenantContext } from '../prisma/with-tenant-context';
import { MfaService } from '../auth/mfa.service';
import { AuthService } from '../auth/auth.service';
import type { AppConfig } from '../config/configuration';
import type { CreateTenantDto } from './dto/platform-admin.dto';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 30;

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly platformPrisma: PlatformPrismaClientProvider,
    private readonly tenantPrismaRaw: TenantPrismaClientProvider,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly mfa: MfaService,
  ) {}

  // ---- Auth (mirrors AuthService's flow but for platform_admin_users) ----

  async login(email: string, password: string) {
    const admin = await this.platformPrisma.platformAdminUser.findUnique({ where: { email } });
    const passwordHash = admin?.passwordHash ?? '$2b$12$invalidsaltinvalidsaltinvalidsaltinvOe';

    if (admin?.lockedUntil && admin.lockedUntil > new Date()) {
      throw new ForbiddenException(`Account locked until ${admin.lockedUntil.toISOString()}`);
    }

    const ok = await bcrypt.compare(password, passwordHash);
    if (!admin || !ok) {
      if (admin) {
        const nextCount = admin.failedLoginCount + 1;
        await this.platformPrisma.platformAdminUser.update({
          where: { id: admin.id },
          data: {
            failedLoginCount: nextCount,
            lockedUntil:
              nextCount >= MAX_FAILED_ATTEMPTS
                ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
                : undefined,
          },
        });
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    if (admin.failedLoginCount > 0 || admin.lockedUntil) {
      await this.platformPrisma.platformAdminUser.update({
        where: { id: admin.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }

    if (!admin.mfaEnabled) {
      const secret = this.mfa.generateSecret();
      const qrCodeDataUrl = await this.mfa.generateQrCodeDataUrl(admin.email, secret);
      const mfaChallengeToken = this.jwt.sign(
        { sub: admin.id, type: 'platform_mfa_enroll', secret },
        { secret: this.config.get('jwt.accessSecret', { infer: true }), expiresIn: '10m' },
      );
      return { status: 'mfa_enrollment_required', mfaChallengeToken, qrCodeDataUrl };
    }

    const mfaChallengeToken = this.jwt.sign(
      { sub: admin.id, type: 'platform_mfa_verify' },
      { secret: this.config.get('jwt.accessSecret', { infer: true }), expiresIn: '10m' },
    );
    return { status: 'mfa_required', mfaChallengeToken };
  }

  async verifyMfa(mfaChallengeToken: string, code: string) {
    const payload = this.decode(mfaChallengeToken, 'platform_mfa_verify');
    const admin = await this.platformPrisma.platformAdminUser.findUnique({
      where: { id: payload.sub },
    });
    if (!admin?.mfaSecret) throw new UnauthorizedException('MFA not configured');
    if (!this.mfa.verifyToken(code, admin.mfaSecret)) {
      throw new UnauthorizedException('Invalid MFA code');
    }
    return { accessToken: this.issueAccessToken(admin.id, admin.email) };
  }

  async completeEnrollment(mfaChallengeToken: string, code: string) {
    const payload = this.decode(mfaChallengeToken, 'platform_mfa_enroll');
    const secret = payload.secret as string;
    if (!this.mfa.verifyToken(code, secret)) {
      throw new UnauthorizedException('Invalid MFA code');
    }
    const admin = await this.platformPrisma.platformAdminUser.update({
      where: { id: payload.sub },
      data: { mfaEnabled: true, mfaSecret: secret },
    });
    return { accessToken: this.issueAccessToken(admin.id, admin.email) };
  }

  private decode(token: string, expectedType: string) {
    let payload: { sub: string; type: string; secret?: string };
    try {
      payload = this.jwt.verify(token, {
        secret: this.config.get('jwt.accessSecret', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA challenge');
    }
    if (payload.type !== expectedType) throw new UnauthorizedException('Wrong challenge type');
    return payload;
  }

  private issueAccessToken(sub: string, email: string) {
    return this.jwt.sign(
      { sub, email, type: 'platform_admin' },
      {
        secret: this.config.get('jwt.accessSecret', { infer: true }),
        expiresIn: this.config.get('jwt.accessTtl', { infer: true }),
      },
    );
  }

  // ---- Tenant provisioning & metadata ----
  //
  // Everything below reads/writes ONLY platform.* tables via
  // `this.platformPrisma`, EXCEPT `seedCompanyAdmin` and `refreshHeadcount`,
  // which deliberately use the separate `hrms_app` connection
  // (`this.tenantPrismaRaw`) scoped to one tenant at a time via
  // `withTenantContext`. That keeps the `hrms_platform` role itself
  // (`this.platformPrisma`'s connection) with literally zero grants on
  // `public` — see tenant-isolation.e2e-spec.ts, which asserts a raw query
  // against public.employees over the platform connection is rejected by
  // Postgres, not just blocked by application code.

  async listTenants() {
    return this.platformPrisma.tenant.findMany({
      include: { subscription: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateTenantStatus(tenantId: string, status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL') {
    return this.platformPrisma.tenant.update({ where: { id: tenantId }, data: { status } });
  }

  async createTenant(dto: CreateTenantDto) {
    const subdomain = dto.subdomain.toLowerCase().trim();
    const existing = await this.platformPrisma.tenant.findUnique({ where: { subdomain } });
    if (existing) throw new ConflictException('Subdomain already in use');

    const tenant = await this.platformPrisma.tenant.create({
      data: {
        name: dto.companyName,
        subdomain,
        status: 'TRIAL',
        subscription: { create: { plan: 'TRIAL', seats: 50 } },
      },
    });

    try {
      await this.seedCompanyAdmin(tenant.id, dto.adminEmail, dto.adminTempPassword);
    } catch (err) {
      // Roll back the tenant record if we couldn't seed its first admin —
      // a tenant with no way to log in is worse than no tenant at all.
      await this.platformPrisma.tenant.delete({ where: { id: tenant.id } });
      throw err;
    }

    await this.refreshHeadcount(tenant.id);
    return this.platformPrisma.tenant.findUnique({
      where: { id: tenant.id },
      include: { subscription: true },
    });
  }

  private async seedCompanyAdmin(tenantId: string, email: string, tempPassword: string) {
    const scoped = withTenantContext(this.tenantPrismaRaw, tenantId);
    const passwordHash = await AuthService.hashPassword(tempPassword);

    const existing = await scoped.user.findFirst({ where: { tenantId, email } });
    if (existing) throw new BadRequestException('That admin email is already in use');

    return scoped.user.create({
      data: { tenantId, email, passwordHash, role: 'COMPANY_ADMIN' },
    });
  }

  private async refreshHeadcount(tenantId: string) {
    const scoped = withTenantContext(this.tenantPrismaRaw, tenantId);
    const count = await scoped.employee.count({ where: { tenantId } });
    await this.platformPrisma.tenant.update({
      where: { id: tenantId },
      data: { employeeCount: count },
    });
  }
}
