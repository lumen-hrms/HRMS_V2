import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type * as admin from 'firebase-admin';
import { FIREBASE_AUTH } from '../firebase/firebase-admin.provider';
import { PlatformPrismaClientProvider } from '../prisma/platform-prisma-client.provider';
import { TenantPrismaClientProvider } from '../prisma/tenant-prisma-client.provider';
import { Prisma } from '@prisma/client';
import { withTenantContext } from '../prisma/with-tenant-context';
import { entitlementsForPlan } from './entitlements';
import type { CreateTenantDto } from './dto/platform-admin.dto';
import type { AuthenticatedPlatformAdmin } from './platform-admin.types';

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly platformPrisma: PlatformPrismaClientProvider,
    private readonly tenantPrismaRaw: TenantPrismaClientProvider,
    @Inject(FIREBASE_AUTH) private readonly firebaseAuth: admin.auth.Auth,
  ) {}

  // ---- Auth ----
  //
  // Firebase's ID token is the session artifact, same as the tenant side
  // (AuthService.session). `type: 'platform_admin'` is the custom claim
  // that keeps a platform admin's token from ever satisfying a tenant
  // user's guard chain, and vice versa.

  async session(idToken: string): Promise<AuthenticatedPlatformAdmin> {
    let decoded: admin.auth.DecodedIdToken;
    try {
      decoded = await this.firebaseAuth.verifyIdToken(idToken);
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

    return { sub: platformAdmin.id, email: platformAdmin.email };
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

    const plan = dto.plan ?? 'STARTER';
    const { enabledModules, features } = entitlementsForPlan(plan);

    const tenant = await this.platformPrisma.tenant.create({
      data: {
        name: dto.companyName,
        subdomain,
        status: 'TRIAL',
        subscription: {
          create: {
            plan,
            seats: 50,
            enabledModules,
            features: features as unknown as Prisma.InputJsonValue,
          },
        },
      },
    });

    try {
      await this.seedCompanyAdmin(tenant.id, dto.adminEmail, dto.adminTempPassword);
      // Working HR-config defaults so the tenant functions before anyone
      // opens Settings (see docs/TENANT_CONFIGURATION.md).
      await this.seedTenantDefaults(tenant.id);
    } catch (err) {
      // Roll back the tenant record if we couldn't finish provisioning —
      // a half-provisioned tenant is worse than no tenant at all.
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

    const existing = await scoped.user.findFirst({ where: { tenantId, email } });
    if (existing) throw new BadRequestException('That admin email is already in use');

    let firebaseUid: string;
    try {
      const created = await this.firebaseAuth.createUser({ email, password: tempPassword });
      firebaseUid = created.uid;
    } catch (err: any) {
      if (err?.code === 'auth/email-already-exists') {
        throw new BadRequestException('That admin email is already registered with Firebase');
      }
      throw err;
    }
    await this.firebaseAuth.setCustomUserClaims(firebaseUid, { tenantId, role: 'COMPANY_ADMIN' });

    return scoped.user.create({
      data: { tenantId, email, firebaseUid, role: 'COMPANY_ADMIN' },
    });
  }

  /**
   * Seeds the tenant's operational HR config with sensible defaults —
   * 5-day week (Sun/Sat off), one 09:00–18:00 "General" shift, self-service
   * attendance. The Company Admin tunes these in-app; nothing here is a
   * commercial/plan concern. Uses the tenant-scoped `hrms_app` connection,
   * same as seedCompanyAdmin (the platform role has no grants on `public`).
   */
  private async seedTenantDefaults(tenantId: string) {
    const scoped = withTenantContext(this.tenantPrismaRaw, tenantId);

    await scoped.tenantSettings.create({ data: { tenantId } });
    await scoped.attendanceSettings.create({ data: { tenantId } });
    await scoped.shift.create({
      data: {
        tenantId,
        name: 'General',
        type: 'FIXED',
        startTime: '09:00',
        endTime: '18:00',
        isDefault: true,
      },
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
