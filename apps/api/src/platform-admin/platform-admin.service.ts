import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type * as admin from 'firebase-admin';
import { FIREBASE_AUTH } from '../firebase/firebase-admin.provider';
import { sendFirebasePasswordResetEmail } from '../firebase/send-reset-email';
import { PlatformPrismaClientProvider } from '../prisma/platform-prisma-client.provider';
import { TenantPrismaClientProvider } from '../prisma/tenant-prisma-client.provider';
import { withTenantContext } from '../prisma/with-tenant-context';
import type { AppConfig } from '../config/configuration';
import type { SellablePlan } from './entitlements';
import { PlansService } from './plans.service';
import type {
  AdjustPricingDto,
  ChangeTenantPlanDto,
  CreateTenantDto,
} from './dto/platform-admin.dto';
import type { AuthenticatedPlatformAdmin } from './platform-admin.types';

@Injectable()
export class PlatformAdminService {
  private readonly logger = new Logger(PlatformAdminService.name);

  constructor(
    private readonly platformPrisma: PlatformPrismaClientProvider,
    private readonly tenantPrismaRaw: TenantPrismaClientProvider,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly plans: PlansService,
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

  async updateTenantStatus(
    tenantId: string,
    status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL',
    actorEmail?: string,
    reason?: string,
  ) {
    const current = await this.platformPrisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true, name: true },
    });
    if (!current) throw new BadRequestException('Tenant not found');
    const updated = await this.platformPrisma.tenant.update({
      where: { id: tenantId },
      data: { status },
    });

    // One row per operator action — the "who suspended/resumed this tenant
    // and when" record. Per-request TENANT_SUSPENDED 403s are deliberately
    // NOT logged (docs/modules/01_IDENTITY_AND_ACCESS.md §9). Non-fatal.
    if (current && current.status !== status) {
      try {
        await this.platformPrisma.platformAuditLog.create({
          data: {
            actorEmail: actorEmail ?? 'unknown',
            action: 'tenant.status_changed',
            targetType: 'tenant',
            targetId: tenantId,
            metadata: {
              tenantName: current.name,
              from: current.status,
              to: status,
              reason: reason ?? null,
            },
          },
        });
      } catch {
        // best-effort — the status change itself already succeeded.
      }
    }

    return updated;
  }

  async createTenant(dto: CreateTenantDto, actorEmail?: string) {
    const subdomain = dto.subdomain.toLowerCase().trim();
    const existing = await this.platformPrisma.tenant.findUnique({ where: { subdomain } });
    if (existing) throw new ConflictException('Subdomain already in use');

    const plan = dto.plan ?? 'STARTER';
    // Snapshot the CURRENT plan definition onto the Subscription. A later
    // Plan edit won't retroactively change this tenant — only a plan change
    // or a renewal re-snapshots (see changeTenantPlan / renewSubscription).
    // `dto.pricePerSeat` is the negotiated rate for this deal; omitted → the
    // plan's list price.
    const snap = await this.plans.snapshotFor(plan, dto.seats, dto.pricePerSeat);

    const tenant = await this.platformPrisma.tenant.create({
      data: {
        name: dto.companyName,
        subdomain,
        status: 'TRIAL',
        subscription: {
          create: {
            plan: snap.plan,
            seats: snap.seats,
            enabledModules: snap.enabledModules,
            features: snap.features,
            pricePerSeat: snap.pricePerSeat,
            isolationTier: snap.isolationTier,
          },
        },
      },
    });

    try {
      await this.seedCompanyAdmin(tenant.id, dto.adminEmail, dto.adminName);
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

    try {
      await this.platformPrisma.platformAuditLog.create({
        data: {
          actorEmail: actorEmail ?? 'unknown',
          action: 'tenant.created',
          targetType: 'tenant',
          targetId: tenant.id,
          metadata: {
            tenantName: tenant.name,
            subdomain,
            plan,
            seats: snap.seats,
            pricePerSeat: snap.pricePerSeat.toFixed(2),
          },
        },
      });
    } catch {
      // best-effort — the tenant is already provisioned.
    }

    return this.platformPrisma.tenant.findUnique({
      where: { id: tenant.id },
      include: { subscription: true },
    });
  }

  /**
   * Move a tenant to a different plan — re-snapshots the plan's CURRENT
   * definition onto the Subscription (modules/features/seats/tier at plan
   * defaults) and RESETS the per-seat rate to the new plan's list price (any
   * prior negotiated rate is dropped — re-negotiate afterwards via
   * `adjustPricing`). Audits `tenant.plan_changed`.
   */
  async changeTenantPlan(tenantId: string, dto: ChangeTenantPlanDto, actorEmail?: string) {
    const sub = await this.platformPrisma.subscription.findUnique({
      where: { tenantId },
      include: { tenant: { select: { name: true } } },
    });
    if (!sub) throw new BadRequestException('Tenant has no subscription');
    if (sub.plan === dto.plan) throw new BadRequestException('That is already the tenant’s plan.');

    const before = sub.plan;
    const snap = await this.plans.snapshotFor(dto.plan);

    await this.platformPrisma.subscription.update({
      where: { tenantId },
      data: {
        plan: snap.plan,
        seats: snap.seats,
        enabledModules: snap.enabledModules,
        features: snap.features,
        pricePerSeat: snap.pricePerSeat,
        isolationTier: snap.isolationTier,
      },
    });

    await this.platformPrisma.platformAuditLog
      .create({
        data: {
          actorEmail: actorEmail ?? 'unknown',
          action: 'tenant.plan_changed',
          targetType: 'tenant',
          targetId: tenantId,
          metadata: {
            tenantName: sub.tenant.name,
            from: before,
            to: dto.plan,
            pricePerSeat: snap.pricePerSeat.toFixed(2),
            reason: dto.reason,
          },
        },
      })
      .catch(() => undefined);

    return this.platformPrisma.tenant.findUnique({
      where: { id: tenantId },
      include: { subscription: true },
    });
  }

  /**
   * Renew the subscription for another term — RE-SNAPSHOTS the tenant's
   * current plan definition (adds modules the plan gained, removes ones it
   * dropped, refreshes tier), keeps the tenant's current seat count AND
   * their negotiated per-seat rate (both are contract terms — a catalog
   * price change doesn't reach an existing customer on renewal), bumps
   * `renewsAt` by a year, and audits `subscription.renewed`.
   *
   * This is the "existing customers pick up the latest plan MODULES on
   * renewal, but keep their negotiated commercials" behaviour. Will later be
   * driven by a scheduled job; for now it's a manual operator action.
   */
  async renewSubscription(tenantId: string, actorEmail?: string) {
    const sub = await this.platformPrisma.subscription.findUnique({
      where: { tenantId },
      include: { tenant: { select: { name: true } } },
    });
    if (!sub) throw new BadRequestException('Tenant has no subscription');

    const keepRate = sub.pricePerSeat != null ? Number(sub.pricePerSeat) : undefined;
    const snap = await this.plans.snapshotFor(sub.plan as SellablePlan, sub.seats, keepRate);
    const nextRenews = new Date(sub.renewsAt ?? Date.now());
    nextRenews.setFullYear(nextRenews.getFullYear() + 1);

    const modulesBefore = sub.enabledModules;
    await this.platformPrisma.subscription.update({
      where: { tenantId },
      data: {
        seats: snap.seats, // = current seats — a negotiated seat count survives renewal
        enabledModules: snap.enabledModules,
        features: snap.features,
        pricePerSeat: snap.pricePerSeat, // = the negotiated rate, carried forward
        isolationTier: snap.isolationTier,
        renewsAt: nextRenews,
      },
    });

    const added = snap.enabledModules.filter((m) => !modulesBefore.includes(m));
    const removed = modulesBefore.filter((m) => !snap.enabledModules.includes(m));

    await this.platformPrisma.platformAuditLog
      .create({
        data: {
          actorEmail: actorEmail ?? 'unknown',
          action: 'subscription.renewed',
          targetType: 'tenant',
          targetId: tenantId,
          metadata: {
            tenantName: sub.tenant.name,
            plan: sub.plan,
            modulesAdded: added,
            modulesRemoved: removed,
            renewsAt: nextRenews.toISOString(),
          },
        },
      })
      .catch(() => undefined);

    return this.platformPrisma.tenant.findUnique({
      where: { id: tenantId },
      include: { subscription: true },
    });
  }

  /**
   * Adjust a tenant's commercials WITHOUT changing plan — the negotiation
   * lever. Sets the negotiated per-seat rate and/or the seat count on the
   * live Subscription (entitlements untouched) and audits
   * `subscription.price_adjusted`. Effective monthly = pricePerSeat * seats.
   */
  async adjustPricing(tenantId: string, dto: AdjustPricingDto, actorEmail?: string) {
    const sub = await this.platformPrisma.subscription.findUnique({
      where: { tenantId },
      include: { tenant: { select: { name: true } } },
    });
    if (!sub) throw new BadRequestException('Tenant has no subscription');

    const rateFrom = sub.pricePerSeat != null ? Number(sub.pricePerSeat) : null;
    const seatsFrom = sub.seats;
    const rateTo = dto.pricePerSeat ?? rateFrom ?? 0;
    const seatsTo = dto.seats ?? seatsFrom;

    if (dto.pricePerSeat === undefined && dto.seats === undefined) {
      throw new BadRequestException('Supply a new per-seat rate, a new seat count, or both.');
    }
    if (rateTo === rateFrom && seatsTo === seatsFrom) {
      throw new BadRequestException('Those are already the tenant’s current terms.');
    }

    await this.platformPrisma.subscription.update({
      where: { tenantId },
      data: {
        pricePerSeat: new Prisma.Decimal(rateTo),
        seats: seatsTo,
      },
    });

    await this.platformPrisma.platformAuditLog
      .create({
        data: {
          actorEmail: actorEmail ?? 'unknown',
          action: 'subscription.price_adjusted',
          targetType: 'tenant',
          targetId: tenantId,
          metadata: {
            tenantName: sub.tenant.name,
            plan: sub.plan,
            rateFrom: rateFrom != null ? rateFrom.toFixed(2) : null,
            rateTo: rateTo.toFixed(2),
            seatsFrom,
            seatsTo,
            monthlyFrom: rateFrom != null ? (rateFrom * seatsFrom).toFixed(2) : null,
            monthlyTo: (rateTo * seatsTo).toFixed(2),
            reason: dto.reason,
          },
        },
      })
      .catch(() => undefined);

    return this.platformPrisma.tenant.findUnique({
      where: { id: tenantId },
      include: { subscription: true },
    });
  }

  /**
   * Creates the tenant's first COMPANY_ADMIN: a Firebase user with a random
   * password (never shown to anyone) + a hosted password-reset email so the
   * customer sets their own password on first sign-in.
   */
  private async seedCompanyAdmin(tenantId: string, email: string, name: string) {
    const scoped = withTenantContext(this.tenantPrismaRaw, tenantId);

    const existing = await scoped.user.findFirst({ where: { tenantId, email } });
    if (existing) throw new BadRequestException('That admin email is already in use');

    let firebaseUid: string;
    try {
      const created = await this.firebaseAuth.createUser({
        email,
        displayName: name,
        password: randomBytes(24).toString('base64url'),
      });
      firebaseUid = created.uid;
    } catch (err: any) {
      if (err?.code === 'auth/email-already-exists') {
        throw new BadRequestException('That admin email is already registered with Firebase');
      }
      throw err;
    }
    await this.firebaseAuth.setCustomUserClaims(firebaseUid, { tenantId, role: 'COMPANY_ADMIN' });

    const user = await scoped.user.create({
      data: { tenantId, email, firebaseUid, role: 'COMPANY_ADMIN' },
    });

    // Non-fatal: the login exists; the operator can re-send the reset link
    // from the console if the email didn't go out.
    try {
      await sendFirebasePasswordResetEmail(
        this.config.get('firebase.webApiKey', { infer: true }),
        email,
      );
    } catch (err) {
      this.logger.error(
        `Tenant admin ${email} created but the password-reset email failed to send`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    return user;
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
