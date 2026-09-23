import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
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
import { buildAccessAuditData, ROLE_LABELS } from '../access/access.support';
import type {
  CreateDepartmentDto,
  CreateEmployeeDto,
  DeleteDepartmentDto,
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

@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly storage: StorageService,
    private readonly fieldEncryption: FieldEncryptionService,
    @Inject(FIREBASE_AUTH) private readonly firebaseAuth: admin.auth.Auth,
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

  async list(user: AuthenticatedUser) {
    const employees = await this.tenantPrisma.client.employee.findMany({
      where: await this.scopeFor(user),
      include: { department: true, reportingManager: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    // No per-row presign here — the list view never renders an avatar
    // image today (see apps/web/src/pages/employees/list.tsx).
    return employees.map((e) => ({ ...this.sanitize(e), photoUrl: null as string | null }));
  }

  async get(id: string, user: AuthenticatedUser) {
    const employee = await this.tenantPrisma.client.employee.findFirst({
      where: { id, ...(await this.scopeFor(user)) },
      include: { department: true, reportingManager: true, directReports: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const { photoKey, ...rest } = this.sanitize(employee);
    return { ...rest, photoUrl: await this.resolvedPhotoUrl(photoKey) };
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

    // Firebase user creation is a network call to the Admin SDK, not a DB
    // write — do it before the transaction rather than inside it, same
    // pattern as PlatformAdminService.seedCompanyAdmin.
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
          userId: createdUserId,
          employeeCode: dto.employeeCode,
          firstName: dto.firstName,
          lastName: dto.lastName,
          personalEmail: dto.personalEmail,
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

    return employee;
  }

  /**
   * RULE-1: an Employee may only ever edit their own record, and only the
   * contact/personal whitelist below — everything else on their request
   * body is silently ignored, never a 403 (keeps the same PATCH shape usable
   * by every role). Line Manager and Auditor have no edit rights at all here
   * (module 03 §8 permission matrix). Admin/HR get the full field set.
   */
  private static readonly EMPLOYEE_EDITABLE_FIELDS = [
    'personalEmail',
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

  async update(id: string, dto: UpdateEmployeeDto, user: AuthenticatedUser) {
    this.assertCanEditEmployee(id, user);
    await this.get(id, user); // 404 / scope check

    const isSelfEdit = user.role === 'EMPLOYEE';
    if (isSelfEdit) {
      const disallowed = Object.keys(dto).filter(
        (k) => !(EmployeesService.EMPLOYEE_EDITABLE_FIELDS as readonly string[]).includes(k),
      );
      for (const k of disallowed) delete (dto as any)[k];
    } else if (dto.reportingManagerId === id) {
      throw new BadRequestException('An employee cannot be their own reporting manager');
    }

    const data: Prisma.EmployeeUncheckedUpdateInput = isSelfEdit
      ? {
          personalEmail: dto.personalEmail,
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
          ctcAnnual: dto.ctcAnnual,
          payGrade: dto.payGrade,
          costCenter: dto.costCenter,
        };
    const updated = await this.tenantPrisma.client.employee.update({ where: { id }, data });
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

    try {
      await this.tenantPrisma.client.auditLog.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
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
          } satisfies Prisma.InputJsonObject,
        },
      });
    } catch (err) {
      this.logger.error(
        `Employee ${id} sensitive fields updated but the audit write failed`,
        err instanceof Error ? err.stack : String(err),
      );
    }

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

    await this.tenantPrisma.client.auditLog.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
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
        } satisfies Prisma.InputJsonObject,
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

    // Do the part that can fail (the Firebase call) *before* any DB write,
    // so a failed cascade never leaves the employee SEPARATED with an
    // untouched, still-active login.
    if (to === 'SEPARATED') {
      await this.disableLinkedLogin(employee, actor);
    }

    const data: Prisma.EmployeeUpdateInput = { lifecycleState: to as any };
    if (requiredDateField && dto.effectiveDate) {
      (data as any)[requiredDateField] = new Date(dto.effectiveDate);
    }

    const updated = await this.tenantPrisma.client.employee.update({ where: { id }, data });

    try {
      await this.tenantPrisma.client.auditLog.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
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
          } satisfies Prisma.InputJsonObject,
        },
      });
    } catch (err) {
      this.logger.error(
        `Employee ${id} moved ${from} -> ${to} but the audit write failed`,
        err instanceof Error ? err.stack : String(err),
      );
    }

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
   */
  async orgChart(user: AuthenticatedUser) {
    const employees = await this.tenantPrisma.client.employee.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        designation: true,
        reportingManagerId: true,
      },
    });
    const byId = new Map(employees.map((e) => [e.id, { ...e, directReports: [] as any[] }]));
    const roots: any[] = [];
    for (const e of byId.values()) {
      if (e.reportingManagerId && byId.has(e.reportingManagerId)) {
        byId.get(e.reportingManagerId)!.directReports.push(e);
      } else {
        roots.push(e);
      }
    }

    if ((user.role === 'EMPLOYEE' || user.role === 'LINE_MANAGER') && user.employeeId) {
      const self = byId.get(user.employeeId);
      return self ? [self] : [];
    }
    return roots;
  }

  // ---- Bulk import ----

  async bulkImport(buffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('Workbook has no sheets');

    const header = (sheet.getRow(1).values as any[]).map((v) => String(v ?? '').trim());
    const col = (name: string) => header.indexOf(name);

    const required = ['employeeCode', 'firstName', 'lastName'];
    for (const r of required) {
      if (col(r) === -1) throw new BadRequestException(`Missing required column: ${r}`);
    }

    const results: { row: number; success: boolean; error?: string }[] = [];
    const tenantId = this.tenantPrisma.tenantId;

    for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
      const row = sheet.getRow(rowNum);
      if (row.values === undefined || (row.values as any[]).length === 0) continue;

      const get = (name: string) => {
        const idx = col(name);
        return idx === -1 ? undefined : row.getCell(idx).text?.trim() || undefined;
      };

      try {
        const employeeCode = get('employeeCode');
        const firstName = get('firstName');
        const lastName = get('lastName');
        if (!employeeCode || !firstName || !lastName) {
          throw new Error('employeeCode, firstName and lastName are required');
        }

        await this.tenantPrisma.client.employee.create({
          data: {
            tenantId,
            employeeCode,
            firstName,
            lastName,
            personalEmail: get('personalEmail'),
            phone: get('phone'),
            designation: get('designation'),
          },
        });
        results.push({ row: rowNum, success: true });
      } catch (err: any) {
        results.push({ row: rowNum, success: false, error: err.message ?? 'Unknown error' });
      }
    }

    return {
      totalRows: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }
}
