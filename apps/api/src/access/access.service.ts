import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type LoginOutcome } from '@prisma/client';
import type * as admin from 'firebase-admin';
import { FIREBASE_AUTH } from '../firebase/firebase-admin.provider';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { AppConfig } from '../config/configuration';
import type { AppRole } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import type { AuditQueryDto, ChangeRoleDto, SetUserStatusDto } from './dto/access.dto';
import {
  assignableRoles,
  buildAccessAuditData,
  deviceLabel,
  frontendAction,
  inDateRange,
  ROLE_LABELS,
  STORED_ACTION,
  type FrontendAuditAction,
} from './access.support';
import type {
  AccessAuditEntryDto,
  AccessUserDto,
  ActivityItemDto,
  LoginAuditEntryDto,
  MeDto,
} from './access.types';

const userInclude = {
  employee: { include: { department: true } },
} satisfies Prisma.UserInclude;

type UserWithEmployee = Prisma.UserGetPayload<{ include: typeof userInclude }>;

/**
 * Identity & Access management (module 01 §4.4). Everything here runs behind
 * `JwtAuthGuard → TenantGuard → RolesGuard`; this service adds the
 * business invariants those guards can't express (RULE-2 privilege ceiling,
 * "keep ≥ 1 active Company Admin", "you can't deactivate yourself") and
 * keeps Firebase custom claims / the Firebase user's disabled flag in sync
 * with the `users` row.
 *
 * Writes are done as sequential single operations through
 * `tenantPrisma.client` (each wrapped in its own RLS-scoped transaction by
 * `withTenantContext`) rather than one interactive `$transaction(fn)` — the
 * same pattern PlatformAdminService uses. The access-change audit row is
 * written right after the mutation; a failed audit write is logged, not
 * surfaced, so it can never turn a completed change into an error response.
 */
@Injectable()
export class AccessService {
  private readonly logger = new Logger(AccessService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(FIREBASE_AUTH) private readonly firebaseAuth: admin.auth.Auth,
  ) {}

  // ---- Users -------------------------------------------------------------

  async listUsers(): Promise<AccessUserDto[]> {
    const users = await this.tenantPrisma.client.user.findMany({
      include: userInclude,
      orderBy: { email: 'asc' },
    });
    const lastLogins = await this.latestSuccessfulLogins(users.map((u) => u.id));
    return users.map((u) => this.toAccessUser(u, lastLogins.get(u.id)));
  }

  async getMe(userId: string, tenantName: string): Promise<MeDto> {
    const user = await this.tenantPrisma.client.user.findUnique({
      where: { id: userId },
      include: userInclude,
    });
    if (!user) throw new NotFoundException('User not found');
    const lastLogins = await this.latestSuccessfulLogins([user.id]);
    return { ...this.toAccessUser(user, lastLogins.get(user.id)), tenantName };
  }

  async changeRole(
    actor: AuthenticatedUser,
    targetId: string,
    dto: ChangeRoleDto,
  ): Promise<AccessUserDto> {
    const target = await this.tenantPrisma.client.user.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');

    if (target.role === dto.newRole) {
      throw new BadRequestException('That is already this user’s role.');
    }
    if (!assignableRoles(actor.role as AppRole).includes(dto.newRole)) {
      throw new ForbiddenException('Only a Company Admin can grant that role.');
    }
    if (
      target.role === 'COMPANY_ADMIN' &&
      target.isActive &&
      (await this.activeCompanyAdminCount()) <= 1
    ) {
      throw new BadRequestException('A workspace must keep at least one active Company Admin.');
    }

    const before = ROLE_LABELS[target.role as AppRole];

    // Custom claim first: it's the only network call, and if it fails
    // nothing in the DB has changed yet.
    try {
      await this.firebaseAuth.setCustomUserClaims(target.firebaseUid, {
        tenantId: this.tenantPrisma.tenantId,
        role: dto.newRole,
      });
    } catch (err) {
      throw new ServiceUnavailableException(
        `Could not update the identity provider: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const updated = await this.tenantPrisma.client.user.update({
      where: { id: targetId },
      data: { role: dto.newRole },
      include: userInclude,
    });

    await this.writeAccessAudit(
      actor,
      'role.changed',
      target.email,
      targetId,
      before,
      ROLE_LABELS[dto.newRole],
      dto.reason,
    );

    const lastLogins = await this.latestSuccessfulLogins([updated.id]);
    return this.toAccessUser(updated, lastLogins.get(updated.id));
  }

  async setStatus(
    actor: AuthenticatedUser,
    targetId: string,
    dto: SetUserStatusDto,
  ): Promise<AccessUserDto> {
    const target = await this.tenantPrisma.client.user.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');

    if (!dto.isActive && target.id === actor.sub) {
      throw new BadRequestException('You can’t deactivate your own account.');
    }
    if (
      !dto.isActive &&
      target.role === 'COMPANY_ADMIN' &&
      target.isActive &&
      (await this.activeCompanyAdminCount()) <= 1
    ) {
      throw new BadRequestException('A workspace must keep at least one active Company Admin.');
    }

    if (target.isActive === dto.isActive) {
      // Nothing to do — return the current shape without an audit row.
      const lastLogins = await this.latestSuccessfulLogins([target.id]);
      const fresh = await this.tenantPrisma.client.user.findUniqueOrThrow({
        where: { id: targetId },
        include: userInclude,
      });
      return this.toAccessUser(fresh, lastLogins.get(fresh.id));
    }

    try {
      await this.firebaseAuth.updateUser(target.firebaseUid, { disabled: !dto.isActive });
      if (!dto.isActive) {
        // Kill any live refresh token so the deactivation bites within
        // minutes, not just on the next natural token expiry.
        await this.firebaseAuth.revokeRefreshTokens(target.firebaseUid);
      }
    } catch (err) {
      throw new ServiceUnavailableException(
        `Could not update the identity provider: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const updated = await this.tenantPrisma.client.user.update({
      where: { id: targetId },
      data: { isActive: dto.isActive },
      include: userInclude,
    });

    await this.writeAccessAudit(
      actor,
      dto.isActive ? 'user.activated' : 'user.deactivated',
      target.email,
      targetId,
      dto.isActive ? 'Deactivated' : 'Active',
      dto.isActive ? 'Active' : 'Deactivated',
      dto.reason,
    );

    const lastLogins = await this.latestSuccessfulLogins([updated.id]);
    return this.toAccessUser(updated, lastLogins.get(updated.id));
  }

  async sendPasswordReset(actor: AuthenticatedUser, targetId: string): Promise<{ email: string }> {
    const target = await this.tenantPrisma.client.user.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');

    await this.sendResetEmail(target.email);
    await this.writeAccessAudit(
      actor,
      'password_reset.sent',
      target.email,
      targetId,
      null,
      null,
      'Hosted password-reset email dispatched.',
    );
    return { email: target.email };
  }

  async recentActivity(targetId: string, limit = 6): Promise<ActivityItemDto[]> {
    const target = await this.tenantPrisma.client.user.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');

    const [logins, changes] = await Promise.all([
      this.tenantPrisma.client.loginAuditEntry.findMany({
        where: { OR: [{ userId: targetId }, { email: target.email }] },
        orderBy: { at: 'desc' },
        take: 20,
      }),
      this.tenantPrisma.client.auditLog.findMany({
        where: { action: { startsWith: 'access.' } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);

    const loginItems: ActivityItemDto[] = logins.map((r) => ({
      kind: 'login',
      at: r.at.toISOString(),
      label: r.outcome === 'SUCCESS' ? 'Signed in' : 'Sign-in failed',
      detail: `${deviceLabel(r.userAgent) ?? 'Unknown device'} · ${r.ipAddress ?? '—'}`,
    }));

    const changeItems: ActivityItemDto[] = changes
      .map((r) => ({ r, m: (r.metadata ?? {}) as Record<string, unknown> }))
      .filter(({ m }) => m.targetEmail === target.email)
      .map(({ r, m }) => {
        const action = frontendAction(r.action);
        const before = (m.before as string | null) ?? null;
        const after = (m.after as string | null) ?? null;
        const actorName = (m.actorName as string) ?? 'Someone';
        return {
          kind: 'access' as const,
          at: r.createdAt.toISOString(),
          label: action ? ACTIVITY_ACTION_LABEL[action] : 'Access changed',
          detail: before && after ? `${before} → ${after} · by ${actorName}` : `by ${actorName}`,
        };
      });

    return [...loginItems, ...changeItems].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }

  // ---- Audit feeds -----------------------------------------------------

  async loginAudit(filter: AuditQueryDto): Promise<LoginAuditEntryDto[]> {
    const where: Prisma.LoginAuditEntryWhereInput = {};
    if (filter.outcome && filter.outcome !== 'ALL') {
      where.outcome = filter.outcome as LoginOutcome;
    }
    let rows = await this.tenantPrisma.client.loginAuditEntry.findMany({
      where,
      orderBy: { at: 'desc' },
    });
    rows = rows.filter((r) => inDateRange(r.at.toISOString(), filter.from, filter.to));
    if (filter.q) {
      const q = filter.q.toLowerCase();
      rows = rows.filter(
        (r) => r.email.toLowerCase().includes(q) || (r.ipAddress ?? '').includes(q),
      );
    }
    return rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      email: r.email,
      userId: r.userId,
      outcome: r.outcome,
      ip: r.ipAddress ?? '',
      userAgent: r.userAgent ?? '',
      deviceLabel: deviceLabel(r.userAgent),
    }));
  }

  async accessAudit(filter: AuditQueryDto): Promise<AccessAuditEntryDto[]> {
    const where: Prisma.AuditLogWhereInput = { action: { startsWith: 'access.' } };
    if (filter.action && filter.action !== 'ALL') {
      where.action = STORED_ACTION[filter.action as FrontendAuditAction];
    }
    let rows = await this.tenantPrisma.client.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    rows = rows.filter((r) => inDateRange(r.createdAt.toISOString(), filter.from, filter.to));

    let mapped = rows
      .map((r) => {
        const action = frontendAction(r.action);
        if (!action) return null;
        const m = (r.metadata ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          at: r.createdAt.toISOString(),
          actorName: (m.actorName as string) ?? 'Unknown',
          actorRole: (m.actorRole as AppRole) ?? 'EMPLOYEE',
          action,
          targetEmail: (m.targetEmail as string) ?? '',
          before: (m.before as string | null) ?? null,
          after: (m.after as string | null) ?? null,
          note: (m.note as string | null) ?? null,
        } satisfies AccessAuditEntryDto;
      })
      .filter((x): x is AccessAuditEntryDto => x !== null);

    if (filter.q) {
      const q = filter.q.toLowerCase();
      mapped = mapped.filter(
        (r) => r.actorName.toLowerCase().includes(q) || r.targetEmail.toLowerCase().includes(q),
      );
    }
    return mapped;
  }

  // ---- internals -----------------------------------------------------

  private toAccessUser(
    u: UserWithEmployee,
    lastLogin?: { at: Date; ipAddress: string | null; userAgent: string | null },
  ): AccessUserDto {
    return {
      id: u.id,
      email: u.email,
      role: u.role as AppRole,
      isActive: u.isActive,
      employee: u.employee
        ? {
            id: u.employee.id,
            firstName: u.employee.firstName,
            lastName: u.employee.lastName,
            employeeCode: u.employee.employeeCode,
            designation: u.employee.designation ?? '',
            department: u.employee.department?.name ?? null,
          }
        : null,
      firebaseUid: u.firebaseUid,
      // Mirrors isActive — the Firebase user's `disabled` flag is flipped in
      // lockstep in setStatus(), so the two never diverge in normal operation.
      firebaseDisabled: !u.isActive,
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: lastLogin ? lastLogin.at.toISOString() : null,
      lastLoginIp: lastLogin?.ipAddress ?? null,
      lastLoginDevice: deviceLabel(lastLogin?.userAgent),
    };
  }

  private async latestSuccessfulLogins(
    userIds: string[],
  ): Promise<Map<string, { at: Date; ipAddress: string | null; userAgent: string | null }>> {
    const map = new Map<string, { at: Date; ipAddress: string | null; userAgent: string | null }>();
    if (userIds.length === 0) return map;
    const rows = await this.tenantPrisma.client.loginAuditEntry.findMany({
      where: { outcome: 'SUCCESS', userId: { in: userIds } },
      orderBy: { at: 'desc' },
      select: { userId: true, at: true, ipAddress: true, userAgent: true },
    });
    for (const r of rows) {
      if (r.userId && !map.has(r.userId)) {
        map.set(r.userId, { at: r.at, ipAddress: r.ipAddress, userAgent: r.userAgent });
      }
    }
    return map;
  }

  private activeCompanyAdminCount(): Promise<number> {
    return this.tenantPrisma.client.user.count({
      where: { role: 'COMPANY_ADMIN', isActive: true },
    });
  }

  private async resolveActorName(actor: AuthenticatedUser): Promise<string> {
    const u = await this.tenantPrisma.client.user.findUnique({
      where: { id: actor.sub },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    if (u?.employee) return `${u.employee.firstName} ${u.employee.lastName}`.trim();
    return humanizeEmail(actor.email);
  }

  private async writeAccessAudit(
    actor: AuthenticatedUser,
    action: FrontendAuditAction,
    targetEmail: string,
    targetUserId: string,
    before: string | null,
    after: string | null,
    note: string | null,
  ): Promise<void> {
    try {
      const actorName = await this.resolveActorName(actor);
      await this.tenantPrisma.client.auditLog.create({
        data: buildAccessAuditData({
          tenantId: this.tenantPrisma.tenantId,
          actorUserId: actor.sub,
          actorName,
          actorRole: actor.role,
          action,
          targetUserId,
          targetEmail,
          before,
          after,
          note,
        }),
      });
    } catch (err) {
      this.logger.error(
        `Failed to write access-change audit (${action}) for ${targetEmail}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Admin-triggered password reset for ANOTHER user. The Firebase Admin SDK
   * can only *generate* a reset link, not send the email — so we call the
   * Identity Toolkit REST endpoint (`accounts:sendOobCode`), which sends
   * Firebase's own hosted template.
   */
  private async sendResetEmail(email: string): Promise<void> {
    const apiKey = this.config.get('firebase.webApiKey', { infer: true });
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'FIREBASE_WEB_API_KEY is not configured — cannot send a hosted reset email.',
      );
    }
    const base = 'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode';

    let res: Response;
    try {
      res = await fetch(`${base}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
      });
    } catch (err) {
      throw new ServiceUnavailableException(
        `Could not reach the identity provider to send a reset email: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // EMAIL_NOT_FOUND would leak account existence to a caller who can
      // already see the user list anyway — but keep the message generic.
      throw new ServiceUnavailableException(
        `The identity provider rejected the reset request (${res.status}). ${body}`.trim(),
      );
    }
  }
}

const ACTIVITY_ACTION_LABEL: Record<FrontendAuditAction, string> = {
  'role.changed': 'Role changed',
  'user.activated': 'Login reactivated',
  'user.deactivated': 'Login deactivated',
  'password_reset.sent': 'Password reset sent',
  'user.created': 'Login created',
};

function humanizeEmail(email: string): string {
  return email
    .split('@')[0]
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
