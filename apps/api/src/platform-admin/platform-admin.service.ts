import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
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
  PlatformAuditQueryDto,
  RequestBreakGlassDto,
} from './dto/platform-admin.dto';
import type {
  AuthenticatedPlatformAdmin,
  BreakGlassGrantDto,
  PlatformAuditAction,
  PlatformAuditEntryDto,
} from './platform-admin.types';

function inDateRange(iso: string, from?: string, to?: string): boolean {
  const day = iso.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

/**
 * Maps one `platform_audit_log` row's free-form `metadata` JSON into the
 * console's fixed { before, after, note } shape. Each `action` was written
 * with a specific metadata shape by the mutation that created it (see the
 * `platformAuditLog.create(...)` call sites above) — this is the inverse.
 */
function mapAuditRow(row: {
  id: string;
  createdAt: Date;
  actorEmail: string;
  action: string;
  metadata: unknown;
}): PlatformAuditEntryDto {
  const m = (row.metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (v === undefined || v === null ? null : String(v));

  let before: string | null = null;
  let after: string | null = null;
  let note: string | null = null;

  switch (row.action) {
    case 'tenant.created':
      after =
        [m.plan, m.seats != null ? `${m.seats} seats` : null].filter(Boolean).join(' · ') || null;
      note = m.subdomain ? `subdomain: ${m.subdomain}` : null;
      break;
    case 'tenant.status_changed':
    case 'tenant.plan_changed':
      before = str(m.from);
      after = str(m.to);
      note = str(m.reason);
      break;
    case 'subscription.renewed': {
      const added = Array.isArray(m.modulesAdded) ? (m.modulesAdded as string[]) : [];
      const removed = Array.isArray(m.modulesRemoved) ? (m.modulesRemoved as string[]) : [];
      after = m.renewsAt ? `renews ${str(m.renewsAt)}` : null;
      note =
        [
          added.length ? `+${added.join(', ')}` : null,
          removed.length ? `-${removed.join(', ')}` : null,
        ]
          .filter(Boolean)
          .join('  ') || null;
      break;
    }
    case 'subscription.price_adjusted':
      before = m.rateFrom != null ? `₹${m.rateFrom} × ${m.seatsFrom}` : null;
      after = `₹${str(m.rateTo)} × ${str(m.seatsTo)}`;
      note = str(m.reason);
      break;
    case 'plan.updated':
      after = Array.isArray(m.changed) ? (m.changed as string[]).join(', ') : null;
      note = str(m.note);
      break;
    case 'headcount.refreshed':
      before = str(m.from);
      after = str(m.to);
      break;
    case 'breakglass.requested':
      after = m.expiresAt ? `expires ${str(m.expiresAt)}` : null;
      note = str(m.reason);
      break;
    case 'breakglass.revoked':
    case 'breakglass.expired':
      note = str(m.reason ?? m.note);
      break;
    default:
      note = str(m.note ?? m.reason);
  }

  return {
    id: row.id,
    at: row.createdAt.toISOString(),
    actorEmail: row.actorEmail,
    action: row.action as PlatformAuditAction,
    targetTenantName: (m.tenantName as string) ?? null,
    before,
    after,
    note,
  };
}

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

  /**
   * `GET /api/platform-admin/tenants/:id` — the console's tenant-detail
   * page. `firstAdminEmail` reads the tenant's oldest COMPANY_ADMIN login
   * over the scoped `hrms_app` connection (same pattern as
   * `resendAdminReset`); `headcountHistory` has no dedicated time-series
   * table yet, so it's the one current data point until that's built.
   */
  async getTenant(tenantId: string) {
    const tenant = await this.platformPrisma.tenant.findUnique({
      where: { id: tenantId },
      include: { subscription: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const scoped = withTenantContext(this.tenantPrismaRaw, tenantId);
    const admin = await scoped.user.findFirst({
      where: { tenantId, role: 'COMPANY_ADMIN' },
      orderBy: { createdAt: 'asc' },
    });

    const recentAudit = await this.audit({ tenantId });

    return {
      ...tenant,
      firstAdminEmail: admin?.email ?? null,
      headcountHistory: [{ at: tenant.updatedAt.toISOString(), count: tenant.employeeCount }],
      recentAudit: recentAudit.slice(0, 20),
    };
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

    let adminResetEmailSent = true;
    try {
      const seeded = await this.seedCompanyAdmin(tenant.id, dto.adminEmail, dto.adminName);
      adminResetEmailSent = seeded.resetEmailSent;
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

    const created = await this.platformPrisma.tenant.findUnique({
      where: { id: tenant.id },
      include: { subscription: true },
    });
    return { ...created, adminResetEmailSent };
  }

  /**
   * Manually re-fires the Company Admin's hosted password-reset email —
   * for when `createTenant`'s `adminResetEmailSent: false` (or the customer
   * just says the email never arrived) instead of leaving the operator with
   * no recourse but a support ticket.
   */
  async resendAdminReset(tenantId: string) {
    const scoped = withTenantContext(this.tenantPrismaRaw, tenantId);
    const admin = await scoped.user.findFirst({
      where: { tenantId, role: 'COMPANY_ADMIN' },
      orderBy: { createdAt: 'asc' },
    });
    if (!admin) throw new BadRequestException('This tenant has no Company Admin to reset');

    await sendFirebasePasswordResetEmail(
      this.config.get('firebase.webApiKey', { infer: true }),
      admin.email,
    );
    return { email: admin.email };
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
      // Anything else here is almost always the Admin SDK itself failing to
      // authenticate to Google (revoked/rotated service-account key, clock
      // skew) rather than a bad request — surface that distinctly instead of
      // letting a raw Firebase error reach the client as an opaque 500.
      this.logger.error(
        `Firebase Admin could not create the tenant admin user for ${email} — check FIREBASE_SERVICE_ACCOUNT_JSON`,
        err instanceof Error ? err.stack : String(err),
      );
      throw new ServiceUnavailableException(
        'Could not create the tenant admin — the identity provider is unreachable. Check the Firebase Admin service-account credentials.',
      );
    }

    try {
      await this.firebaseAuth.setCustomUserClaims(firebaseUid, { tenantId, role: 'COMPANY_ADMIN' });
    } catch (err) {
      this.logger.error(
        `Firebase Admin could not set custom claims for ${email} — check FIREBASE_SERVICE_ACCOUNT_JSON`,
        err instanceof Error ? err.stack : String(err),
      );
      throw new ServiceUnavailableException(
        'Could not finish setting up the tenant admin — the identity provider is unreachable. Check the Firebase Admin service-account credentials.',
      );
    }

    const user = await scoped.user.create({
      data: { tenantId, email, firebaseUid, role: 'COMPANY_ADMIN' },
    });

    // Non-fatal: the login exists either way. `resetEmailSent` is surfaced
    // all the way up to the New Tenant wizard so the operator isn't left
    // guessing why the customer says they never got the email — the only
    // trace used to be this log line.
    let resetEmailSent = true;
    try {
      await sendFirebasePasswordResetEmail(
        this.config.get('firebase.webApiKey', { infer: true }),
        email,
      );
    } catch (err) {
      resetEmailSent = false;
      this.logger.error(
        `Tenant admin ${email} created but the password-reset email failed to send`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    return { user, resetEmailSent };
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

  /**
   * `GET /api/platform-admin/audit` — read side of `PlatformAuditLog`
   * (docs/modules/02_PLATFORM_ADMIN.md §9, item 1). Rows are append-only and
   * already written by every mutating operator action above; this only
   * reads + filters + reshapes them for the console.
   */
  async audit(filter: PlatformAuditQueryDto): Promise<PlatformAuditEntryDto[]> {
    const where: Prisma.PlatformAuditLogWhereInput = {};
    if (filter.tenantId) where.targetId = filter.tenantId;
    if (filter.action) where.action = filter.action;

    const rows = await this.platformPrisma.platformAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    let mapped = rows
      .filter((r) => inDateRange(r.createdAt.toISOString(), filter.from, filter.to))
      .map(mapAuditRow);

    if (filter.q) {
      const q = filter.q.toLowerCase();
      mapped = mapped.filter(
        (r) =>
          r.actorEmail.toLowerCase().includes(q) ||
          (r.targetTenantName ?? '').toLowerCase().includes(q),
      );
    }

    return mapped;
  }

  private async refreshHeadcount(tenantId: string) {
    const scoped = withTenantContext(this.tenantPrismaRaw, tenantId);
    const count = await scoped.employee.count({ where: { tenantId } });
    await this.platformPrisma.tenant.update({
      where: { id: tenantId },
      data: { employeeCount: count },
    });
    return count;
  }

  /**
   * `POST /api/platform-admin/tenants/:id/refresh-headcount` — expose the
   * existing on-demand `refreshHeadcount()` (already called internally by
   * `createTenant`) as an operator-triggerable route, with an audit row.
   */
  async refreshHeadcountRoute(tenantId: string, actorEmail?: string) {
    const before = await this.platformPrisma.tenant.findUnique({
      where: { id: tenantId },
      select: { employeeCount: true, name: true },
    });
    if (!before) throw new NotFoundException('Tenant not found');

    const employeeCount = await this.refreshHeadcount(tenantId);

    if (employeeCount !== before.employeeCount) {
      await this.platformPrisma.platformAuditLog
        .create({
          data: {
            actorEmail: actorEmail ?? 'unknown',
            action: 'headcount.refreshed',
            targetType: 'tenant',
            targetId: tenantId,
            metadata: { tenantName: before.name, from: before.employeeCount, to: employeeCount },
          },
        })
        .catch(() => undefined);
    }

    return { employeeCount };
  }

  // ---- Break-glass support access ----
  //
  // The auditable control-plane record for time-boxed, logged, read-only
  // support access (CLAUDE.md's multi-tenancy section). Deliberately does
  // NOT itself widen `hrms_platform`'s grants — see the migration comment
  // on `platform.break_glass_grants`.

  async requestBreakGlass(tenantId: string, dto: RequestBreakGlassDto, actorEmail?: string) {
    const tenant = await this.platformPrisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const existing = await this.platformPrisma.breakGlassGrant.findFirst({
      where: { tenantId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
    });
    if (existing) {
      throw new ConflictException('This tenant already has an active break-glass grant');
    }

    const expiresAt = new Date(Date.now() + dto.ttlMinutes * 60_000);
    const grant = await this.platformPrisma.breakGlassGrant.create({
      data: {
        tenantId,
        requestedBy: actorEmail ?? 'unknown',
        reason: dto.reason,
        expiresAt,
      },
    });

    await this.platformPrisma.platformAuditLog
      .create({
        data: {
          actorEmail: actorEmail ?? 'unknown',
          action: 'breakglass.requested',
          targetType: 'tenant',
          targetId: tenantId,
          metadata: {
            tenantName: tenant.name,
            reason: dto.reason,
            expiresAt: expiresAt.toISOString(),
          },
        },
      })
      .catch(() => undefined);

    return { id: grant.id, expiresAt: expiresAt.toISOString() };
  }

  /** `GET /api/platform-admin/tenants/:id/breakglass` — the tenant's current ACTIVE grant, if any. */
  async getActiveBreakGlass(tenantId: string): Promise<BreakGlassGrantDto | null> {
    const grant = await this.platformPrisma.breakGlassGrant.findFirst({
      where: { tenantId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      include: { tenant: { select: { name: true } } },
      orderBy: { grantedAt: 'desc' },
    });
    if (!grant) return null;

    return {
      id: grant.id,
      tenantName: grant.tenant.name,
      reason: grant.reason,
      grantedAt: grant.grantedAt.toISOString(),
      expiresAt: grant.expiresAt.toISOString(),
      status: grant.status,
      accessCount: grant.accessCount,
    };
  }

  async revokeBreakGlass(tenantId: string, grantId: string, actorEmail?: string) {
    const grant = await this.platformPrisma.breakGlassGrant.findUnique({
      where: { id: grantId },
      include: { tenant: { select: { name: true } } },
    });
    if (!grant || grant.tenantId !== tenantId) throw new NotFoundException('Grant not found');
    if (grant.status !== 'ACTIVE') throw new BadRequestException('This grant is not active');

    await this.platformPrisma.breakGlassGrant.update({
      where: { id: grantId },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedBy: actorEmail ?? 'unknown' },
    });

    await this.platformPrisma.platformAuditLog
      .create({
        data: {
          actorEmail: actorEmail ?? 'unknown',
          action: 'breakglass.revoked',
          targetType: 'tenant',
          targetId: tenantId,
          metadata: { tenantName: grant.tenant.name },
        },
      })
      .catch(() => undefined);

    return { status: 'REVOKED' as const };
  }

  /**
   * Flips ACTIVE grants past `expiresAt` to EXPIRED and audits it — called
   * by `BreakGlassExpiryProcessor` (a daily BullMQ job). Not a route: expiry
   * is time-driven, not operator-triggered.
   */
  async expireOverdueBreakGlassGrants() {
    const overdue = await this.platformPrisma.breakGlassGrant.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: new Date() } },
      include: { tenant: { select: { name: true } } },
    });
    for (const grant of overdue) {
      await this.platformPrisma.breakGlassGrant.update({
        where: { id: grant.id },
        data: { status: 'EXPIRED' },
      });
      await this.platformPrisma.platformAuditLog
        .create({
          data: {
            actorEmail: 'system:breakglass-expiry',
            action: 'breakglass.expired',
            targetType: 'tenant',
            targetId: grant.tenantId,
            metadata: { tenantName: grant.tenant.name },
          },
        })
        .catch(() => undefined);
    }
    return overdue.length;
  }
}
