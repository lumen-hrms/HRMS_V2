import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { Prisma } from '@prisma/client';
import type * as admin from 'firebase-admin';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { StorageService } from '../storage/storage.service';
import { FIREBASE_AUTH } from '../firebase/firebase-admin.provider';
import {
  FieldEncryptionService,
  maskBankAccount,
  maskPan,
} from '../crypto/field-encryption.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import type { AppRole } from '../common/decorators/roles.decorator';
import { assignableRoles, buildAccessAuditData, ROLE_LABELS } from '../access/access.support';
import { AuditService } from '../audit/audit.service';
import { LeaveEntitlementService } from '../leave/leave-entitlement.service';
import { AuthEmailService } from '../notifications/auth-email.service';
import { teamRelations, type TeamRelation } from './team';
import type {
  CreateDepartmentDto,
  CreateEmployeeDto,
  CreateLoginDto,
  DeleteDepartmentDto,
  LinkLoginDto,
  RevealFieldDto,
  TransitionLifecycleDto,
  UpdateDepartmentDto,
  UpdateEmployeeDto,
  UpdateSensitiveFieldsDto,
  UpsertEmergencyContactDto,
} from './dto/employee.dto';

const ALLOWED_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

type LifecycleState =
  'PRE_JOINING' | 'PROBATION' | 'CONFIRMED' | 'NOTICE_PERIOD' | 'SUSPENDED' | 'SEPARATED';

/**
 * Allowed-transition graph from module 03 §4.4, each edge naming the date
 * field it requires (undefined = no mandatory date, e.g. NOTICE_PERIOD's
 * withdrawal back to CONFIRMED, or a SUSPENDED reinstatement). SUSPENDED can
 * return to either active state — the caller (HR/Admin) picks which via
 * `targetState`; there's no implicit "prior state" tracking.
 */
const LIFECYCLE_TRANSITIONS: Record<
  LifecycleState,
  Partial<Record<LifecycleState, string | undefined>>
> = {
  PRE_JOINING: { PROBATION: undefined },
  PROBATION: { CONFIRMED: 'confirmationDate', SEPARATED: 'lastWorkingDate', SUSPENDED: undefined },
  CONFIRMED: { NOTICE_PERIOD: 'noticeStartDate', SUSPENDED: undefined },
  NOTICE_PERIOD: { SEPARATED: 'lastWorkingDate', CONFIRMED: undefined },
  SUSPENDED: { PROBATION: undefined, CONFIRMED: undefined },
  SEPARATED: {},
};

/** email local-part → "Jane Doe" style label for audit actor names. */
function humanizeEmail(email: string): string {
  return email
    .split('@')[0]
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

const TEMP_PASSWORD_LENGTH = 12;
const TEMP_PASSWORD_CHARS = {
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  lower: 'abcdefghijkmnopqrstuvwxyz',
  digit: '23456789',
};

/**
 * Random alphanumeric temporary password (ambiguous 0/O/1/l/I left out so it
 * survives being read off an email), with at least one upper, lower and digit.
 */
function generateTempPassword(): string {
  const all = Object.values(TEMP_PASSWORD_CHARS).join('');
  const pick = (set: string) => set[randomInt(set.length)];
  const chars = [
    pick(TEMP_PASSWORD_CHARS.upper),
    pick(TEMP_PASSWORD_CHARS.lower),
    pick(TEMP_PASSWORD_CHARS.digit),
  ];
  while (chars.length < TEMP_PASSWORD_LENGTH) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly storage: StorageService,
    private readonly fieldEncryption: FieldEncryptionService,
    @Inject(FIREBASE_AUTH) private readonly firebaseAuth: admin.auth.Auth,
    private readonly audit: AuditService,
    private readonly entitlement: LeaveEntitlementService,
    private readonly authEmails: AuthEmailService,
  ) {}

  /**
   * "Own reports only" (Line Manager) / "own data only" (Employee) scoping,
   * applied on top of whatever RLS already restricted to this tenant. RLS
   * guarantees tenant isolation; this is ordinary service-layer authorization
   * within a tenant, same as any single-tenant app would need.
   *
   * Line Manager resolves the FULL recursive subtree (module 03 §12's open
   * question, decided: recursive, not direct-reports-only) — in-memory BFS
   * over `{id, reportingManagerId}` pairs, same "fine at hundreds, revisit
   * for large tenants" tradeoff `orgChart()` already accepts, rather than a
   * raw recursive CTE (which would bypass the RLS session var this request's
   * transaction sets — see `with-tenant-context.ts`).
   */
  private async scopeFor(user: AuthenticatedUser): Promise<Prisma.EmployeeWhereInput> {
    switch (user.role) {
      case 'EMPLOYEE':
        return { id: user.employeeId ?? '__none__' };
      case 'LINE_MANAGER': {
        if (!user.employeeId) return { id: '__none__' };
        const subordinateIds = await this.subordinateIds(user.employeeId);
        return { id: { in: [user.employeeId, ...subordinateIds] } };
      }
      default:
        return {};
    }
  }

  /** BFS over the tenant's manager->report edges; every descendant of `managerId`, any depth. */
  private async subordinateIds(managerId: string): Promise<string[]> {
    const edges = await this.tenantPrisma.client.employee.findMany({
      select: { id: true, reportingManagerId: true },
    });
    const directReportsOf = new Map<string, string[]>();
    for (const e of edges) {
      if (!e.reportingManagerId) continue;
      const list = directReportsOf.get(e.reportingManagerId) ?? [];
      list.push(e.id);
      directReportsOf.set(e.reportingManagerId, list);
    }
    const result: string[] = [];
    const queue = [...(directReportsOf.get(managerId) ?? [])];
    while (queue.length) {
      const id = queue.shift()!;
      if (result.includes(id)) continue; // cycle guard — a bad reportingManagerId chain must never infinite-loop
      result.push(id);
      queue.push(...(directReportsOf.get(id) ?? []));
    }
    return result;
  }

  /**
   * Never let ciphertext leave the service. `panMasked`/`bankAccountMasked`
   * are precomputed at write time (§ updateSensitiveFields) specifically so
   * a read never needs to touch the encryption key at all — only an
   * explicit `revealField` call does.
   */
  private sanitize<
    T extends { panCiphertext?: string | null; bankAccountCiphertext?: string | null },
  >(employee: T): Omit<T, 'panCiphertext' | 'bankAccountCiphertext'> {
    const rest: any = { ...employee };
    delete rest.panCiphertext;
    delete rest.bankAccountCiphertext;
    return rest;
  }

  // ---- Departments ----

  listDepartments() {
    return this.tenantPrisma.client.department.findMany({ orderBy: { name: 'asc' } });
  }

  createDepartment(dto: CreateDepartmentDto) {
    return this.tenantPrisma.client.department.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        name: dto.name,
        code: dto.code,
        headEmployeeId: dto.headEmployeeId,
      },
    });
  }

  async updateDepartment(id: string, dto: UpdateDepartmentDto) {
    const department = await this.tenantPrisma.client.department.findUnique({ where: { id } });
    if (!department) throw new NotFoundException('Department not found');
    return this.tenantPrisma.client.department.update({ where: { id }, data: dto });
  }

  /** RULE-6: block deletion of a non-empty department unless a reassignment target is given. */
  async deleteDepartment(id: string, dto: DeleteDepartmentDto) {
    const department = await this.tenantPrisma.client.department.findUnique({ where: { id } });
    if (!department) throw new NotFoundException('Department not found');

    const employeeCount = await this.tenantPrisma.client.employee.count({
      where: { departmentId: id },
    });
    if (employeeCount > 0) {
      if (!dto.reassignToDepartmentId) {
        throw new BadRequestException(
          `${employeeCount} employee(s) are still in this department — provide reassignToDepartmentId to move them first.`,
        );
      }
      if (dto.reassignToDepartmentId === id) {
        throw new BadRequestException('Cannot reassign a department into itself');
      }
      const target = await this.tenantPrisma.client.department.findUnique({
        where: { id: dto.reassignToDepartmentId },
      });
      if (!target) throw new NotFoundException('Reassignment target department not found');

      await this.tenantPrisma.client.$transaction([
        this.tenantPrisma.client.employee.updateMany({
          where: { departmentId: id },
          data: { departmentId: dto.reassignToDepartmentId },
        }),
        this.tenantPrisma.client.department.delete({ where: { id } }),
      ]);
      return { reassigned: employeeCount, deleted: true };
    }

    await this.tenantPrisma.client.department.delete({ where: { id } });
    return { reassigned: 0, deleted: true };
  }

  // ---- Employees ----

  /**
   * The view-only company directory an Employee or Line Manager gets instead
   * of the scoped list below: everyone still employed, but only what the org
   * chart already shows them — no compensation, DOB, personal email or
   * statutory IDs, and no lifecycle status (notice period / suspension isn't
   * for colleagues to see). Each row also says how it relates to the caller
   * (`teamRelation`) so the UI can offer a *My team* filter. Rows are never
   * openable as a full profile beyond what `get()` allows: an Employee only
   * their own, a Line Manager their own and their reports'. A Line Manager
   * additionally keeps status and employment type for those rows (including
   * reports who have left), as the old scoped list gave them.
   */
  private async directory(user: AuthenticatedUser) {
    const rows = await this.tenantPrisma.client.employee.findMany({
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        designation: true,
        workLocation: true,
        dateOfJoining: true,
        phone: true,
        lifecycleState: true,
        employmentType: true,
        reportingManagerId: true,
        department: { select: { name: true } },
        reportingManager: { select: { firstName: true, lastName: true } },
        user: { select: { email: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    // Relations are worked out over everyone, including people who have left,
    // so a departed manager in the middle doesn't cut off the chain below them.
    const relations = user.employeeId
      ? teamRelations(rows, user.employeeId)
      : new Map<string, TeamRelation>();
    const isManager = user.role === 'LINE_MANAGER';
    const inManagerScope = (id: string) =>
      isManager && ['SELF', 'REPORT'].includes(relations.get(id) ?? '');
    return rows
      .filter((r) => r.lifecycleState !== 'SEPARATED' || inManagerScope(r.id))
      .map(({ user: login, lifecycleState, employmentType, ...e }) => ({
        ...e,
        workEmail: login?.email ?? null,
        teamRelation: relations.get(e.id) ?? null,
        ...(inManagerScope(e.id) ? { lifecycleState, employmentType } : {}),
      }));
  }

  async list(user: AuthenticatedUser) {
    if (user.role === 'EMPLOYEE' || user.role === 'LINE_MANAGER') return this.directory(user);
    const employees = await this.tenantPrisma.client.employee.findMany({
      where: await this.scopeFor(user),
      include: { department: true, reportingManager: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    // No per-row presign here — the list view never renders an avatar
    // image today (see apps/web/src/pages/employees/list.tsx).
    return employees.map((e) => ({ ...this.sanitize(e), photoUrl: null as string | null }));
  }

  /** Whether `code` is free for a new employee in this tenant (exact match, like the unique index). */
  async isEmployeeCodeAvailable(code: string | undefined) {
    const trimmed = code?.trim();
    if (!trimmed) throw new BadRequestException('Employee code is required');
    const existing = await this.tenantPrisma.client.employee.findFirst({
      where: { employeeCode: trimmed },
      select: { id: true },
    });
    return { available: !existing };
  }

  async get(id: string, user: AuthenticatedUser) {
    const employee = await this.tenantPrisma.client.employee.findFirst({
      // AND, not a spread: the Employee / Line Manager scope has its own `id`
      // key, which would silently replace the requested one.
      where: { AND: [{ id }, await this.scopeFor(user)] },
      include: {
        department: true,
        reportingManager: true,
        directReports: true,
        user: { select: { email: true } },
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const { photoKey, user: login, ...rest } = this.sanitize(employee);
    // The login's actual sign-in email, so HR can spot a mismatch with the
    // employee's email — only for the roles that can fix it.
    const seesLogin = user.role === 'COMPANY_ADMIN' || user.role === 'HR_MANAGER';
    return {
      ...rest,
      ...(seesLogin ? { loginEmail: login?.email ?? null } : {}),
      photoUrl: await this.resolvedPhotoUrl(photoKey),
    };
  }

  /** Resolves the private object-storage key into a short-lived, viewable URL. */
  private async resolvedPhotoUrl(photoKey: string | null): Promise<string | null> {
    if (!photoKey) return null;
    return this.storage.getPresignedDownloadUrl(photoKey, 3600);
  }

  /**
   * Uploads a new avatar image (self, or Admin/HR for anyone) — replaces
   * `photoUrl` as a hand-typed URL field (module 03 gap). Deletes the
   * previous object, same lifecycle as document replacement, so orphaned
   * objects don't accumulate.
   */
  async uploadPhoto(employeeId: string, file: Express.Multer.File, actor: AuthenticatedUser) {
    this.assertCanEditEmployee(employeeId, actor);
    const existing = await this.tenantPrisma.client.employee.findUnique({
      where: { id: employeeId },
      select: { photoKey: true },
    });
    if (!existing) throw new NotFoundException('Employee not found');

    if (!ALLOWED_PHOTO_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported image type "${file.mimetype}" — allowed: JPEG, PNG, WebP.`,
      );
    }
    if (file.size > MAX_PHOTO_SIZE_BYTES) {
      throw new BadRequestException('Image exceeds the 5 MB limit.');
    }

    const tenantId = this.tenantPrisma.tenantId;
    const key = this.storage.buildKey(tenantId, employeeId, file.originalname);
    await this.storage.upload(key, file.buffer, file.mimetype);
    if (existing.photoKey) {
      await this.storage.delete(existing.photoKey).catch(() => undefined);
    }
    await this.tenantPrisma.client.employee.update({
      where: { id: employeeId },
      data: { photoKey: key },
    });
    return { photoUrl: await this.resolvedPhotoUrl(key) };
  }

  async create(dto: CreateEmployeeDto, actor?: AuthenticatedUser) {
    const tenantId = this.tenantPrisma.tenantId;

    if (dto.existingUserId && (dto.loginEmail || dto.loginTempPassword)) {
      throw new BadRequestException(
        'Either create a new login (loginEmail + loginTempPassword) or link an existing one (existingUserId), not both',
      );
    }
    // Validated before any write, so a rejected link never leaves a
    // half-created employee behind.
    const linkedUser = dto.existingUserId
      ? await this.assertLinkableLogin(dto.existingUserId, actor)
      : undefined;

    // Firebase user creation is a network call to the Admin SDK, not a DB
    // write — do it before the transaction rather than inside it, same
    // pattern as PlatformAdminService.createAdminLogin.
    let pendingUser: { email: string; firebaseUid: string; role: string } | undefined;
    if (dto.loginEmail && dto.loginTempPassword) {
      const role = (dto.loginRole as string) ?? 'EMPLOYEE';
      let firebaseUid: string;
      try {
        const created = await this.firebaseAuth.createUser({
          email: dto.loginEmail,
          password: dto.loginTempPassword,
        });
        firebaseUid = created.uid;
      } catch (err: any) {
        if (err?.code === 'auth/email-already-exists') {
          throw new BadRequestException('That login email is already registered with Firebase');
        }
        throw err;
      }
      await this.firebaseAuth.setCustomUserClaims(firebaseUid, { tenantId, role });
      pendingUser = { email: dto.loginEmail, firebaseUid, role };
    }

    let createdUserId: string | undefined;
    const employee = await this.tenantPrisma.client.$transaction(async (tx) => {
      if (pendingUser) {
        const user = await tx.user.create({
          data: {
            tenantId,
            email: pendingUser.email,
            firebaseUid: pendingUser.firebaseUid,
            role: pendingUser.role as any,
          },
        });
        createdUserId = user.id;
      }

      return tx.employee.create({
        data: {
          tenantId,
          userId: linkedUser?.id ?? createdUserId,
          employeeCode: dto.employeeCode,
          firstName: dto.firstName,
          lastName: dto.lastName,
          // The login's email doubles as the employee's email.
          personalEmail: dto.personalEmail ?? pendingUser?.email,
          phone: dto.phone,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
          gender: dto.gender,
          departmentId: dto.departmentId,
          designation: dto.designation,
          dateOfJoining: dto.dateOfJoining ? new Date(dto.dateOfJoining) : undefined,
          reportingManagerId: dto.reportingManagerId,
        },
      });
    });

    // A provisioned login is an Identity & Access event — record it in the
    // same access-change trail the Access module reads
    // (GET /api/access/audit?feed=access). Non-fatal: a failed audit write
    // must not fail employee creation.
    if (pendingUser && createdUserId) {
      try {
        await this.tenantPrisma.client.auditLog.create({
          data: buildAccessAuditData({
            tenantId,
            actorUserId: actor?.sub ?? createdUserId,
            actorName: actor?.email ? humanizeEmail(actor.email) : 'System',
            actorRole: actor?.role ?? 'HR_MANAGER',
            action: 'user.created',
            targetUserId: createdUserId,
            targetEmail: pendingUser.email,
            after: ROLE_LABELS[pendingUser.role as AppRole] ?? pendingUser.role,
            note: 'Login provisioned via Employee Master.',
          }),
        });
      } catch (err) {
        this.logger.error(
          `Employee created but the access-change audit write failed for ${pendingUser.email}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    if (linkedUser && actor) {
      await this.auditLoginLinked(
        actor,
        linkedUser,
        employee,
        'Linked when the employee was created.',
      );
    }

    await this.applyLeavePolicy([employee.id]);
    return employee;
  }

  /**
   * A new hire's leave for the current year (prorated from their joining
   * date) right away, instead of waiting for tonight's accrual job — which
   * would credit it anyway, so a failure here only delays it.
   */
  private async applyLeavePolicy(employeeIds: string[]) {
    try {
      await this.entitlement.applyPolicyDefaults(
        this.tenantPrisma.client,
        this.tenantPrisma.tenantId,
        new Date(),
        { employeeIds },
      );
    } catch (err) {
      this.logger.error(
        'Could not apply leave policy to a new employee — the nightly accrual job will',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Links a login that already exists in this tenant to an employee that has
   * none — the only way the first Company Admin (created at tenant onboarding
   * with no employee record) gets self-service Leave/Attendance/Payslips.
   * Never changes the login's role.
   */
  async linkLogin(employeeId: string, dto: LinkLoginDto, actor: AuthenticatedUser) {
    const employee = await this.tenantPrisma.client.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        userId: true,
        lifecycleState: true,
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.userId) throw new BadRequestException('This employee already has a login');
    if (employee.lifecycleState === 'SEPARATED') {
      throw new BadRequestException('Cannot link a login to a separated employee');
    }
    const user = await this.assertLinkableLogin(dto.userId, actor);

    // `userId: null` in the filter closes the race with a concurrent link of
    // the same employee; the unique index on employees.user_id closes the
    // race with a concurrent link of the same login.
    let count: number;
    try {
      ({ count } = await this.tenantPrisma.client.employee.updateMany({
        where: { id: employeeId, userId: null },
        data: { userId: user.id },
      }));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('That login is already linked to another employee');
      }
      throw e;
    }
    if (count === 0) throw new BadRequestException('This employee already has a login');

    await this.auditLoginLinked(actor, user, employee, 'Linked to an existing employee record.');
    return { employeeId, userId: user.id };
  }

  /**
   * Creates a NEW login for an employee that has none (the counterpart to
   * `linkLogin`, which attaches an existing one). The temporary password is
   * generated here and only ever goes out by email — it is never returned to
   * the caller or stored. If the email can't be sent the login still exists
   * and `emailSent: false` tells the admin to send a password reset instead.
   */
  async createLogin(employeeId: string, dto: CreateLoginDto, actor: AuthenticatedUser) {
    const tenantId = this.tenantPrisma.tenantId;
    const employee = await this.tenantPrisma.client.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        userId: true,
        lifecycleState: true,
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.userId) throw new BadRequestException('This employee already has a login');
    if (employee.lifecycleState === 'SEPARATED') {
      throw new BadRequestException('Cannot create a login for a separated employee');
    }
    const role = (dto.loginRole ?? 'EMPLOYEE') as AppRole;
    if (!assignableRoles(actor.role as AppRole).includes(role)) {
      throw new ForbiddenException(`Only a Company Admin can grant the ${ROLE_LABELS[role]} role`);
    }

    // Firebase first (a network call, not a DB write); undone below if the
    // DB write then fails so a retry doesn't hit "email already registered".
    const tempPassword = generateTempPassword();
    let firebaseUid: string;
    try {
      ({ uid: firebaseUid } = await this.firebaseAuth.createUser({
        email: dto.loginEmail,
        password: tempPassword,
      }));
    } catch (err: any) {
      if (err?.code === 'auth/email-already-exists') {
        throw new BadRequestException('That login email is already registered with Firebase');
      }
      throw err;
    }

    let userId: string;
    try {
      await this.firebaseAuth.setCustomUserClaims(firebaseUid, { tenantId, role });
      userId = await this.tenantPrisma.client.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { tenantId, email: dto.loginEmail, firebaseUid, role: role as any },
        });
        // `userId: null` closes the race with a concurrent login for the same employee.
        // The login email becomes the employee's email too (one email, everywhere).
        const { count } = await tx.employee.updateMany({
          where: { id: employeeId, userId: null },
          data: { userId: user.id, personalEmail: dto.loginEmail },
        });
        if (count === 0) throw new BadRequestException('This employee already has a login');
        return user.id;
      });
    } catch (err) {
      await this.firebaseAuth.deleteUser(firebaseUid).catch((e) => {
        this.logger.error(`Could not roll back Firebase user ${firebaseUid}`, String(e));
      });
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('That login email is already in use in this workspace');
      }
      throw err;
    }

    const data = buildAccessAuditData({
      tenantId,
      actorUserId: actor.sub,
      actorName: actor.email ? humanizeEmail(actor.email) : 'System',
      actorRole: actor.role,
      action: 'user.created',
      targetUserId: userId,
      targetEmail: dto.loginEmail,
      after: ROLE_LABELS[role] ?? role,
      note: `Login created for ${employee.firstName} ${employee.lastName} (${employee.employeeCode}) from Employee Master.`,
    });
    await this.audit.log({ ...data, metadata: data.metadata as Record<string, unknown> });

    let emailSent = true;
    try {
      await this.authEmails.sendLoginCredentials({
        email: dto.loginEmail,
        tenantId,
        employeeCode: employee.employeeCode,
        tempPassword,
        recipientName: `${employee.firstName} ${employee.lastName}`.trim(),
      });
    } catch (err) {
      emailSent = false;
      this.logger.error(
        `Login created for ${dto.loginEmail} but the credentials email failed`,
        err instanceof Error ? err.stack : String(err),
      );
    }
    return { employeeId, userId, email: dto.loginEmail, emailSent };
  }

  /**
   * Manual "refresh": makes the login's sign-in email match the employee's
   * current email. `update()` does this automatically on an email edit; this
   * covers a wrong email at creation, an email edited before the login
   * existed, or any drift since.
   */
  async syncLoginEmail(employeeId: string, actor: AuthenticatedUser) {
    const employee = await this.tenantPrisma.client.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, userId: true, personalEmail: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (!employee.userId) throw new BadRequestException('This employee has no login');
    if (!employee.personalEmail) {
      throw new BadRequestException('Set the employee’s email first, then sync the login');
    }
    const changed = await this.changeLoginEmail(employee.userId, employee.personalEmail, actor);
    return { employeeId, email: employee.personalEmail, changed };
  }

  /**
   * Changes a login's sign-in email in Firebase and the `users` row together
   * (Firebase first; undone if the DB write then fails). Returns false when
   * it already matches. The user's password and sessions are untouched.
   */
  private async changeLoginEmail(
    userId: string,
    newEmail: string,
    actor: AuthenticatedUser,
  ): Promise<boolean> {
    const user = await this.tenantPrisma.client.user.findUnique({ where: { id: userId } });
    if (!user || user.tenantId !== this.tenantPrisma.tenantId) {
      throw new NotFoundException('Login not found');
    }
    if (user.email.toLowerCase() === newEmail.toLowerCase()) return false;

    try {
      await this.firebaseAuth.updateUser(user.firebaseUid, { email: newEmail });
    } catch (err: any) {
      if (err?.code === 'auth/email-already-exists') {
        throw new BadRequestException('That email is already used by another login');
      }
      if (err?.code === 'auth/invalid-email') {
        throw new BadRequestException('That is not a valid email address');
      }
      throw err;
    }
    try {
      await this.tenantPrisma.client.user.update({
        where: { id: userId },
        data: { email: newEmail },
      });
    } catch (err) {
      await this.firebaseAuth.updateUser(user.firebaseUid, { email: user.email }).catch((e) => {
        this.logger.error(`Could not roll back Firebase email for ${user.firebaseUid}`, String(e));
      });
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('That email is already used by another login');
      }
      throw err;
    }

    const data = buildAccessAuditData({
      tenantId: this.tenantPrisma.tenantId,
      actorUserId: actor.sub,
      actorName: actor.email ? humanizeEmail(actor.email) : 'System',
      actorRole: actor.role,
      action: 'user.email_changed',
      targetUserId: userId,
      targetEmail: newEmail,
      before: user.email,
      after: newEmail,
      note: 'Login email updated to match the employee’s email.',
    });
    await this.audit.log({ ...data, metadata: data.metadata as Record<string, unknown> });
    return true;
  }

  /**
   * A linkable login: in this tenant, not already linked, and within the
   * actor's RULE-2 privilege ceiling (an HR Manager can't attach a Company
   * Admin's login to an employee record — same ceiling as role assignment).
   */
  private async assertLinkableLogin(userId: string, actor: AuthenticatedUser | undefined) {
    if (!actor) throw new ForbiddenException('Linking a login requires an authenticated actor');
    const user = await this.tenantPrisma.client.user.findUnique({
      where: { id: userId },
      include: { employee: { select: { id: true } } },
    });
    // RLS already hides other tenants' rows; the explicit check is defense in
    // depth, and both cases read as "not found" so nothing leaks.
    if (!user || user.tenantId !== this.tenantPrisma.tenantId) {
      throw new NotFoundException('Login not found');
    }
    if (user.employee)
      throw new BadRequestException('That login is already linked to another employee');
    if (!assignableRoles(actor.role as AppRole).includes(user.role as AppRole)) {
      throw new ForbiddenException(
        `Only a Company Admin can link a ${ROLE_LABELS[user.role as AppRole] ?? user.role} login`,
      );
    }
    return user;
  }

  private async auditLoginLinked(
    actor: AuthenticatedUser,
    user: { id: string; email: string },
    employee: { employeeCode: string; firstName: string; lastName: string },
    note: string,
  ) {
    const data = buildAccessAuditData({
      tenantId: this.tenantPrisma.tenantId,
      actorUserId: actor.sub,
      actorName: actor.email ? humanizeEmail(actor.email) : 'System',
      actorRole: actor.role,
      action: 'user.linked',
      targetUserId: user.id,
      targetEmail: user.email,
      before: null,
      after: `${employee.firstName} ${employee.lastName} (${employee.employeeCode})`,
      note,
    });
    await this.audit.log({ ...data, metadata: data.metadata as Record<string, unknown> });
  }

  /**
   * RULE-1: an Employee may only ever edit their own record, and only the
   * contact/personal whitelist below — everything else on their request
   * body is silently ignored, never a 403 (keeps the same PATCH shape usable
   * by every role). Line Manager and Auditor have no edit rights at all here
   * (module 03 §8 permission matrix). Admin/HR get the full field set.
   * The email is deliberately absent: it is the login's sign-in email, so
   * only HR sets it.
   */
  private static readonly EMPLOYEE_EDITABLE_FIELDS = [
    'phone',
    'gender',
    'maritalStatus',
    'bloodGroup',
    'nationality',
  ] as const;

  /**
   * Same actor-vs-target rule as `update()`, factored out for the other
   * per-employee write paths (emergency contacts) that only checked row
   * *visibility* via `get()` before this — which let a Line Manager write
   * to a report's record, not just view it (module 03 §8: Line Manager has
   * no edit rights on anyone, not even reports).
   */
  private assertCanEditEmployee(employeeId: string, user: AuthenticatedUser) {
    if (user.role === 'LINE_MANAGER' || user.role === 'AUDITOR') {
      throw new ForbiddenException('You cannot edit employee records');
    }
    if (user.role === 'EMPLOYEE' && user.employeeId !== employeeId) {
      throw new ForbiddenException('You can only edit your own record');
    }
  }

  /** Compensation/org fields worth a before/after audit trail — everything
   *  else on this endpoint (contact details, personal attributes) only gets
   *  a `fieldsChanged` entry, same restraint `updateSensitiveFields` uses. */
  private static readonly AUDITED_UPDATE_FIELDS = [
    'designation',
    'departmentId',
    'reportingManagerId',
    'employmentType',
    'workLocation',
    'ctcAnnual',
    'payGrade',
    'costCenter',
  ] as const;

  /** Making `managerId` the manager of `id` must not put `id` above themselves in the chain. */
  private async assertNoReportingLoop(id: string, managerId: string) {
    const seen = new Set<string>();
    for (let cur: string | null = managerId; cur && !seen.has(cur);) {
      if (cur === id) {
        throw new BadRequestException(
          'That would create a reporting loop — the chosen manager already reports (directly or indirectly) to this employee',
        );
      }
      seen.add(cur);
      const row: { reportingManagerId: string | null } | null =
        await this.tenantPrisma.client.employee.findUnique({
          where: { id: cur },
          select: { reportingManagerId: true },
        });
      if (!row && cur === managerId) throw new BadRequestException('Reporting manager not found');
      cur = row?.reportingManagerId ?? null;
    }
  }

  async update(id: string, dto: UpdateEmployeeDto, user: AuthenticatedUser) {
    this.assertCanEditEmployee(id, user);
    const existing = await this.get(id, user); // 404 / scope check

    const isSelfEdit = user.role === 'EMPLOYEE';
    if (isSelfEdit) {
      const disallowed = Object.keys(dto).filter(
        (k) => !(EmployeesService.EMPLOYEE_EDITABLE_FIELDS as readonly string[]).includes(k),
      );
      for (const k of disallowed) delete (dto as any)[k];
    } else if (dto.reportingManagerId === id) {
      throw new BadRequestException('An employee cannot be their own reporting manager');
    } else if (dto.reportingManagerId) {
      await this.assertNoReportingLoop(id, dto.reportingManagerId);
    }
    if (!isSelfEdit && dto.departmentId) {
      const dept = await this.tenantPrisma.client.department.findUnique({
        where: { id: dto.departmentId },
      });
      if (!dept) throw new BadRequestException('Department not found');
    }

    // One email everywhere: an HR edit also moves the login's sign-in email
    // (which is also where notifications go). Done before the employee write
    // so a clash with another login rejects the whole edit.
    if (!isSelfEdit && dto.personalEmail && existing.userId) {
      await this.changeLoginEmail(existing.userId, dto.personalEmail, user);
    }

    const data: Prisma.EmployeeUncheckedUpdateInput = isSelfEdit
      ? {
          phone: dto.phone,
          gender: dto.gender,
          maritalStatus: dto.maritalStatus,
          bloodGroup: dto.bloodGroup,
          nationality: dto.nationality,
        }
      : {
          firstName: dto.firstName,
          lastName: dto.lastName,
          personalEmail: dto.personalEmail,
          phone: dto.phone,
          gender: dto.gender,
          departmentId: dto.departmentId,
          designation: dto.designation,
          reportingManagerId: dto.reportingManagerId,
          maritalStatus: dto.maritalStatus,
          bloodGroup: dto.bloodGroup,
          nationality: dto.nationality,
          employmentType: dto.employmentType as any,
          workLocation: dto.workLocation,
          workState: dto.workState,
          weeklyOffDaysOverride: dto.weeklyOffDaysOverride,
          ctcAnnual: dto.ctcAnnual,
          payGrade: dto.payGrade,
          costCenter: dto.costCenter,
        };
    const updated = await this.tenantPrisma.client.employee.update({ where: { id }, data });

    const fieldsChanged = Object.keys(dto).filter((k) => (dto as any)[k] !== undefined);
    if (fieldsChanged.length > 0) {
      const changes = fieldsChanged
        .filter((k) => (EmployeesService.AUDITED_UPDATE_FIELDS as readonly string[]).includes(k))
        .map((k) => ({
          field: k,
          before: (existing as any)[k] ?? null,
          after: (updated as any)[k] ?? null,
        }))
        .filter((c) => c.before !== c.after);

      await this.audit.log({
        actorUserId: user.sub,
        action: 'employee.updated',
        targetType: 'employee',
        targetId: id,
        metadata: {
          module: 'employee-master',
          actorName: user.email ? humanizeEmail(user.email) : 'System',
          actorRole: user.role,
          fieldsChanged,
          changes,
        },
      });
    }

    return this.sanitize(updated);
  }

  /**
   * Statutory + bank fields (module 03 §4.2/INV-3) — a dedicated endpoint so
   * PAN and the bank account number are never written through the generic
   * `update()` path. Both are KMS-encrypted (`FieldEncryptionService`); only
   * the ciphertext and a precomputed masked form are stored — plaintext
   * never lands in a column, and a read never needs the encryption key.
   */
  async updateSensitiveFields(id: string, dto: UpdateSensitiveFieldsDto, actor: AuthenticatedUser) {
    await this.get(id, actor); // 404 / scope check

    const data: Prisma.EmployeeUpdateInput = {
      aadhaarLast4: dto.aadhaarLast4,
      uan: dto.uan,
      pfNumber: dto.pfNumber,
      esicNumber: dto.esicNumber,
      taxRegime: dto.taxRegime as any,
      bankAccountHolderName: dto.bankAccountHolderName,
      bankIfsc: dto.bankIfsc,
      bankName: dto.bankName,
      bankBranch: dto.bankBranch,
      bankAccountType: dto.bankAccountType as any,
    };
    if (dto.pan) {
      data.panCiphertext = this.fieldEncryption.encrypt(dto.pan);
      data.panMasked = maskPan(dto.pan);
    }
    if (dto.bankAccountNumber) {
      data.bankAccountCiphertext = this.fieldEncryption.encrypt(dto.bankAccountNumber);
      data.bankAccountMasked = maskBankAccount(dto.bankAccountNumber);
    }

    const updated = await this.tenantPrisma.client.employee.update({ where: { id }, data });

    await this.audit.log({
      actorUserId: actor.sub,
      action: 'employee.sensitive_fields_updated',
      targetType: 'employee',
      targetId: id,
      metadata: {
        module: 'employee-master',
        actorName: actor.email ? humanizeEmail(actor.email) : 'System',
        actorRole: actor.role,
        // Which fields changed, never the values themselves.
        fieldsChanged: Object.keys(dto),
      },
    });

    return this.sanitize(updated);
  }

  /**
   * Masked-reveal (module 03 §5.6/INV-3): decrypts exactly one field and
   * logs the reveal (actor, field, employee, reason, timestamp) — the
   * decrypted value itself is returned to the caller but never written to
   * the audit row.
   */
  async revealField(id: string, dto: RevealFieldDto, actor: AuthenticatedUser) {
    const employee = await this.tenantPrisma.client.employee.findFirst({
      where: { id, ...(await this.scopeFor(actor)) },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const ciphertext =
      dto.field === 'pan' ? employee.panCiphertext : employee.bankAccountCiphertext;
    if (!ciphertext) {
      throw new BadRequestException(`No ${dto.field} is on file for this employee`);
    }
    const value = this.fieldEncryption.decrypt(ciphertext);

    await this.audit.log({
      actorUserId: actor.sub,
      action: 'employee.field_revealed',
      targetType: 'employee',
      targetId: id,
      metadata: {
        module: 'employee-master',
        actorName: actor.email ? humanizeEmail(actor.email) : 'System',
        actorRole: actor.role,
        field: dto.field,
        reason: dto.reason,
      },
    });

    return { field: dto.field, value };
  }

  // ---- Emergency contacts ----

  async listEmergencyContacts(employeeId: string, user: AuthenticatedUser) {
    await this.get(employeeId, user); // 404 / scope check
    return this.tenantPrisma.client.emergencyContact.findMany({
      where: { employeeId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  /** RULE-5: exactly one `isPrimary` contact — unsetting the old one is part of the same transaction. */
  async createEmergencyContact(
    employeeId: string,
    dto: UpsertEmergencyContactDto,
    user: AuthenticatedUser,
  ) {
    this.assertCanEditEmployee(employeeId, user);
    await this.get(employeeId, user); // 404 / scope check
    const tenantId = this.tenantPrisma.tenantId;

    return this.tenantPrisma.client.$transaction(async (tx) => {
      if (dto.isPrimary) {
        await tx.emergencyContact.updateMany({ where: { employeeId }, data: { isPrimary: false } });
      }
      return tx.emergencyContact.create({
        data: {
          tenantId,
          employeeId,
          name: dto.name,
          relationship: dto.relationship,
          phone: dto.phone,
          altPhone: dto.altPhone,
          address: dto.address,
          isPrimary: dto.isPrimary ?? false,
        },
      });
    });
  }

  async updateEmergencyContact(
    employeeId: string,
    contactId: string,
    dto: UpsertEmergencyContactDto,
    user: AuthenticatedUser,
  ) {
    this.assertCanEditEmployee(employeeId, user);
    await this.get(employeeId, user); // 404 / scope check
    const existing = await this.tenantPrisma.client.emergencyContact.findFirst({
      where: { id: contactId, employeeId },
    });
    if (!existing) throw new NotFoundException('Emergency contact not found');

    return this.tenantPrisma.client.$transaction(async (tx) => {
      if (dto.isPrimary) {
        await tx.emergencyContact.updateMany({
          where: { employeeId, id: { not: contactId } },
          data: { isPrimary: false },
        });
      }
      return tx.emergencyContact.update({
        where: { id: contactId },
        data: {
          name: dto.name,
          relationship: dto.relationship,
          phone: dto.phone,
          altPhone: dto.altPhone,
          address: dto.address,
          isPrimary: dto.isPrimary,
        },
      });
    });
  }

  async deleteEmergencyContact(employeeId: string, contactId: string, user: AuthenticatedUser) {
    this.assertCanEditEmployee(employeeId, user);
    await this.get(employeeId, user); // 404 / scope check
    const existing = await this.tenantPrisma.client.emergencyContact.findFirst({
      where: { id: contactId, employeeId },
    });
    if (!existing) throw new NotFoundException('Emergency contact not found');
    await this.tenantPrisma.client.emergencyContact.delete({ where: { id: contactId } });
    return { deleted: true };
  }

  /**
   * The lifecycle transition endpoint (module 03 §4.4/RULE-4). Validates the
   * move against the state machine, writes the date the target state
   * requires, cascades a SEPARATED transition into disabling the linked
   * login (module 01), and records an audit row — mirrors the shape
   * AccessService.setStatus() uses for the same Firebase-disable pattern.
   */
  async transitionLifecycle(id: string, dto: TransitionLifecycleDto, actor: AuthenticatedUser) {
    const employee = await this.get(id, actor);
    const from = employee.lifecycleState as LifecycleState;
    const to = dto.targetState as LifecycleState;

    const edges = LIFECYCLE_TRANSITIONS[from];
    if (!edges || !(to in edges)) {
      throw new BadRequestException(`Cannot move an employee from ${from} to ${to}`);
    }
    const requiredDateField = edges[to];
    if (requiredDateField && !dto.effectiveDate) {
      throw new BadRequestException(`${to} requires ${requiredDateField}`);
    }
    if (dto.separationReason && to !== 'SEPARATED') {
      throw new BadRequestException('separationReason only applies to a SEPARATED transition');
    }

    // Do the part that can fail (the Firebase call) *before* any DB write,
    // so a failed cascade never leaves the employee SEPARATED with an
    // untouched, still-active login.
    if (to === 'SEPARATED') {
      await this.disableLinkedLogin(employee, actor);
    }

    const data: Prisma.EmployeeUpdateInput = { lifecycleState: to as any };
    if (to === 'SEPARATED') {
      data.separationReason = (dto.separationReason ?? null) as any;
    }
    if (requiredDateField && dto.effectiveDate) {
      (data as any)[requiredDateField] = new Date(dto.effectiveDate);
    }

    const updated = await this.tenantPrisma.client.employee.update({ where: { id }, data });

    await this.audit.log({
      actorUserId: actor.sub,
      action: 'employee.lifecycle_changed',
      targetType: 'employee',
      targetId: id,
      metadata: {
        module: 'employee-master',
        actorName: actor.email ? humanizeEmail(actor.email) : 'System',
        actorRole: actor.role,
        employeeCode: employee.employeeCode,
        before: from,
        after: to,
        reason: dto.reason,
        ...(to === 'SEPARATED' ? { separationReason: dto.separationReason ?? null } : {}),
      },
    });

    return updated;
  }

  /**
   * SEPARATED cascade (module 03 §4.4/§5.5): disable the linked Firebase
   * user + revoke its refresh tokens + flip `users.isActive`, same sequence
   * AccessService.setStatus() uses for an explicit deactivation. No-op if
   * the employee never had a linked login.
   */
  private async disableLinkedLogin(employee: { userId: string | null }, actor: AuthenticatedUser) {
    if (!employee.userId) return;
    const user = await this.tenantPrisma.client.user.findUnique({ where: { id: employee.userId } });
    if (!user || !user.isActive) return;

    try {
      await this.firebaseAuth.updateUser(user.firebaseUid, { disabled: true });
      await this.firebaseAuth.revokeRefreshTokens(user.firebaseUid);
    } catch (err) {
      this.logger.error(
        `Separation cascade: could not disable Firebase user for ${user.email}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw new BadRequestException(
        'Could not disable the employee’s login — the identity provider call failed. The employee was not separated; retry.',
      );
    }

    await this.tenantPrisma.client.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });

    await this.tenantPrisma.client.auditLog.create({
      data: buildAccessAuditData({
        tenantId: this.tenantPrisma.tenantId,
        actorUserId: actor.sub,
        actorName: actor.email ? humanizeEmail(actor.email) : 'System',
        actorRole: actor.role,
        action: 'user.deactivated',
        targetUserId: user.id,
        targetEmail: user.email,
        before: 'Active',
        after: 'Deactivated',
        note: 'Deactivated by the SEPARATED lifecycle cascade (Employee Master).',
      }),
    });
  }

  /**
   * Org hierarchy, shaped as a manager -> reports tree. Rooted per role
   * (module 03 §5.7/§8): Employee and Line Manager get their own subtree
   * (self + recursive reports); HR/Admin/Auditor get the whole company from
   * the top. Building the full map first (one query, RLS already scopes it
   * to the tenant) and then picking the root is the same "fine at hundreds"
   * approach as before — just returning a different slice of it now.
   *
   * Each node carries what the org-chart hover card shows: work email (the
   * linked login's email — never `personalEmail`, the chart is visible to
   * too many people for that), phone, department, location, a presigned photo URL, and
   * report counts. SEPARATED employees are left out — an ex-employee isn't
   * part of the org; their former reports surface as roots until HR
   * reassigns them, which is the correct "needs fixing" signal.
   */
  async orgChart(user: AuthenticatedUser) {
    const employees = await this.tenantPrisma.client.employee.findMany({
      where: { lifecycleState: { not: 'SEPARATED' } },
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        designation: true,
        photoKey: true,
        phone: true,
        workLocation: true,
        lifecycleState: true,
        dateOfJoining: true,
        reportingManagerId: true,
        department: { select: { id: true, name: true } },
        user: { select: { email: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    type OrgNode = Omit<(typeof employees)[number], 'user' | 'photoKey'> & {
      photoUrl: string | null;
      workEmail: string | null;
      manager: { id: string; firstName: string; lastName: string } | null;
      directReportCount: number;
      totalReportCount: number;
      directReports: OrgNode[];
    };

    // Avatars live in a private bucket — `resolvedPhotoUrl` signs a
    // short-lived URL only for people who have one (same as `get()`).
    const nodes = await Promise.all(
      employees.map(async ({ user: login, photoKey, ...e }): Promise<OrgNode> => ({
        ...e,
        photoUrl: await this.resolvedPhotoUrl(photoKey),
        workEmail: login?.email ?? null,
        manager: null,
        directReportCount: 0,
        totalReportCount: 0,
        directReports: [],
      })),
    );
    const byId = new Map<string, OrgNode>(nodes.map((n) => [n.id, n]));
    const roots: OrgNode[] = [];
    for (const node of byId.values()) {
      const manager = node.reportingManagerId ? byId.get(node.reportingManagerId) : undefined;
      if (manager) {
        manager.directReports.push(node);
        node.manager = { id: manager.id, firstName: manager.firstName, lastName: manager.lastName };
      } else {
        roots.push(node);
      }
    }

    // Post-order count of every descendant. A bad reportingManagerId cycle
    // never reaches `roots`, but a Line Manager/Employee rooted inside one
    // would recurse forever (and fail JSON serialization) — so the edge that
    // closes the cycle is pruned rather than followed.
    const visited = new Set<string>();
    const countReports = (node: OrgNode): number => {
      visited.add(node.id);
      node.directReports = node.directReports.filter((r) => !visited.has(r.id));
      node.directReportCount = node.directReports.length;
      node.totalReportCount = node.directReports.reduce((sum, r) => sum + 1 + countReports(r), 0);
      return node.totalReportCount;
    };

    if ((user.role === 'EMPLOYEE' || user.role === 'LINE_MANAGER') && user.employeeId) {
      const self = byId.get(user.employeeId);
      if (!self) return [];
      countReports(self);
      return [self];
    }
    roots.forEach(countReports);
    return roots;
  }
}
