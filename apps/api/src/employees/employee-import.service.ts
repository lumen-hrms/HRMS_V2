import { Inject, Injectable, Logger } from '@nestjs/common';
import { BankAccountType, EmploymentType, IndianState, Prisma, TaxRegime } from '@prisma/client';
import { randomBytes } from 'crypto';
import type * as admin from 'firebase-admin';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { FIREBASE_AUTH } from '../firebase/firebase-admin.provider';
import {
  FieldEncryptionService,
  maskBankAccount,
  maskPan,
} from '../crypto/field-encryption.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import type { AppRole } from '../common/decorators/roles.decorator';
import { assignableRoles, buildAccessAuditData, ROLE_LABELS } from '../access/access.support';
import { AuditService, type AuditLogInput } from '../audit/audit.service';
import { mapWithConcurrency } from '../common/concurrency.util';
import { AuthEmailService } from '../notifications/auth-email.service';
import {
  buildReport,
  IMPORT_CONCURRENCY,
  type ImportReport,
  type ImportRowResult,
  normalizeHeader,
  type OnImportProgress,
  parseImportDate,
  readSpreadsheet,
  type SheetRow,
  toEnumKey,
} from '../common/bulk-import';
import {
  AADHAAR_LAST4_PATTERN,
  BANK_ACCOUNT_TYPES,
  EMPLOYMENT_TYPES,
  IFSC_PATTERN,
  PAN_PATTERN,
  TAX_REGIMES,
} from './dto/employee.dto';

/**
 * Every column the employee import understands, in template order. Headers
 * are matched loosely (`Employee Code`, `employee_code` and `employeeCode`
 * are the same column). `employeeCode` is always required; `firstName` and
 * `lastName` only when the code is new (a create). On an update, a blank
 * cell means "leave this field as it is", never "clear it".
 */
export const EMPLOYEE_IMPORT_COLUMNS = [
  'employeeCode',
  'firstName',
  'lastName',
  'personalEmail',
  'phone',
  'dateOfBirth',
  'gender',
  'maritalStatus',
  'bloodGroup',
  'nationality',
  'department',
  'designation',
  'employmentType',
  'dateOfJoining',
  'workLocation',
  'workState',
  'reportingManagerCode',
  'payGrade',
  'costCenter',
  'pan',
  'aadhaarLast4',
  'uan',
  'pfNumber',
  'esicNumber',
  'taxRegime',
  'bankAccountHolderName',
  'bankAccountNumber',
  'bankIfsc',
  'bankName',
  'bankBranch',
  'bankAccountType',
  'loginEmail',
  'loginRole',
] as const;

type Column = (typeof EMPLOYEE_IMPORT_COLUMNS)[number];
const COLUMN_BY_HEADER = new Map<string, Column>(
  EMPLOYEE_IMPORT_COLUMNS.map((c) => [normalizeHeader(c), c]),
);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UAN_PATTERN = /^\d{12}$/;
const BANK_ACCOUNT_PATTERN = /^\d{9,18}$/;
const INDIAN_STATES = new Set<string>(Object.values(IndianState));
const LOGIN_ROLES: AppRole[] = [
  'COMPANY_ADMIN',
  'HR_MANAGER',
  'LINE_MANAGER',
  'EMPLOYEE',
  'AUDITOR',
];

/** Plain (non-encrypted) Employee columns a row can set, as written to Prisma. */
type EmployeeFields = Partial<{
  firstName: string;
  lastName: string;
  personalEmail: string;
  phone: string;
  dateOfBirth: Date;
  gender: string;
  maritalStatus: string;
  bloodGroup: string;
  nationality: string;
  designation: string;
  employmentType: EmploymentType;
  dateOfJoining: Date;
  workLocation: string;
  workState: IndianState;
  payGrade: string;
  costCenter: string;
  aadhaarLast4: string;
  uan: string;
  pfNumber: string;
  esicNumber: string;
  taxRegime: TaxRegime;
  bankAccountHolderName: string;
  bankIfsc: string;
  bankName: string;
  bankBranch: string;
  bankAccountType: BankAccountType;
}>;

interface PlannedRow {
  row: number;
  code: string | null;
  action: 'create' | 'update' | null;
  existingId: string | null;
  fields: EmployeeFields;
  pan?: string;
  bankAccountNumber?: string;
  departmentName?: string;
  managerCode?: string;
  login?: { email: string; role: AppRole };
  errors: string[];
  warnings: string[];
}

interface ExistingEmployee {
  id: string;
  employeeCode: string;
  reportingManagerId: string | null;
  userId: string | null;
}

/**
 * Employee Master bulk import (module 03). Two calls over the same file:
 * `dryRun` validates every row and reports exactly what would happen
 * (creates vs updates, departments that would be created, per-row errors)
 * without writing anything; the commit re-validates and imports every valid
 * row — a bad row never blocks the good ones.
 *
 * Writes go through the same rules as the single-employee paths: PAN and
 * bank account are field-encrypted with only ciphertext + a masked form
 * stored (`updateSensitiveFields`), a login is a Firebase user + custom
 * claims + `users` row (`create`), role grants are capped by
 * `assignableRoles` (an HR Manager can't mint a Company Admin), and every
 * row is audited by field name, never by sensitive value.
 */
@Injectable()
export class EmployeeImportService {
  private readonly logger = new Logger(EmployeeImportService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly fieldEncryption: FieldEncryptionService,
    @Inject(FIREBASE_AUTH) private readonly firebaseAuth: admin.auth.Auth,
    private readonly audit: AuditService,
    private readonly authEmails: AuthEmailService,
  ) {}

  async import(
    buffer: Buffer | undefined,
    actor: AuthenticatedUser,
    dryRun: boolean,
    onProgress?: OnImportProgress,
  ): Promise<ImportReport> {
    const sheet = await readSpreadsheet(buffer);
    const ignoredColumns = sheet.headers.filter((h) => !COLUMN_BY_HEADER.has(h));

    const client = this.tenantPrisma.client;
    const [existing, departments, users] = await Promise.all([
      client.employee.findMany({
        select: { id: true, employeeCode: true, reportingManagerId: true, userId: true },
      }) as Promise<ExistingEmployee[]>,
      client.department.findMany({ select: { id: true, name: true } }),
      client.user.findMany({ select: { email: true } }),
    ]);
    const existingByCode = new Map(existing.map((e) => [e.employeeCode, e]));
    const departmentByName = new Map(departments.map((d) => [d.name.toLowerCase(), d]));
    const takenLoginEmails = new Set(users.map((u) => u.email.toLowerCase()));

    const planned = sheet.rows.map((r) =>
      this.parseRow(r, existingByCode, takenLoginEmails, actor.role as AppRole),
    );
    this.flagDuplicates(planned);
    this.flagMissingEncryptionKey(planned);
    await this.flagFirebaseEmailClashes(planned);
    this.resolveManagers(planned, existing);

    // Case-insensitive, first spelling wins: "Legal" and "legal" are one department.
    const newDepartmentsByKey = new Map<string, string>();
    for (const p of planned) {
      if (p.errors.length > 0 || !p.departmentName) continue;
      const key = p.departmentName.toLowerCase();
      if (!departmentByName.has(key) && !newDepartmentsByKey.has(key)) {
        newDepartmentsByKey.set(key, p.departmentName);
      }
    }
    const newDepartments = [...newDepartmentsByKey.values()];

    if (dryRun) {
      const results = planned.map((p) => this.toResult(p, p.errors.length === 0));
      return buildReport(true, results, ignoredColumns, {
        create: planned.filter((p) => p.errors.length === 0 && p.action === 'create').length,
        update: planned.filter((p) => p.errors.length === 0 && p.action === 'update').length,
        logins: planned.filter((p) => p.errors.length === 0 && p.login).length,
        newDepartments,
      });
    }

    return this.commit(
      planned,
      actor,
      departmentByName,
      newDepartments,
      ignoredColumns,
      onProgress,
    );
  }

  // ---- Validation ----

  private parseRow(
    sheetRow: SheetRow,
    existingByCode: Map<string, ExistingEmployee>,
    takenLoginEmails: Set<string>,
    actorRole: AppRole,
  ): PlannedRow {
    const get = (c: Column) => sheetRow.values.get(normalizeHeader(c));
    const p: PlannedRow = {
      row: sheetRow.row,
      code: get('employeeCode') ?? null,
      action: null,
      existingId: null,
      fields: {},
      errors: [],
      warnings: [],
    };
    const f = p.fields;
    const err = (msg: string) => p.errors.push(msg);

    if (!p.code) {
      err('employeeCode is required');
      return p;
    }
    const current = existingByCode.get(p.code);
    p.action = current ? 'update' : 'create';
    p.existingId = current?.id ?? null;

    f.firstName = get('firstName');
    f.lastName = get('lastName');
    if (p.action === 'create') {
      if (!f.firstName) err('firstName is required for a new employee');
      if (!f.lastName) err('lastName is required for a new employee');
    }

    for (const c of [
      'phone',
      'gender',
      'maritalStatus',
      'bloodGroup',
      'nationality',
      'designation',
      'workLocation',
      'payGrade',
      'costCenter',
      'pfNumber',
      'esicNumber',
      'bankAccountHolderName',
      'bankName',
      'bankBranch',
    ] as const) {
      f[c] = get(c);
    }

    const personalEmail = get('personalEmail');
    if (personalEmail) {
      if (EMAIL_PATTERN.test(personalEmail)) f.personalEmail = personalEmail;
      else err(`personalEmail "${personalEmail}" is not a valid email`);
    }

    for (const c of ['dateOfBirth', 'dateOfJoining'] as const) {
      const raw = get(c);
      if (!raw) continue;
      const iso = parseImportDate(raw);
      if (!iso) err(`${c} "${raw}" is not a date — use YYYY-MM-DD or DD-MM-YYYY`);
      else f[c] = new Date(iso);
    }
    if (f.dateOfBirth && f.dateOfBirth > new Date()) err('dateOfBirth is in the future');

    const enumCol = (c: Column, allowed: readonly string[]) => {
      const raw = get(c);
      if (!raw) return undefined;
      const key = toEnumKey(raw);
      if (allowed.includes(key)) return key;
      err(`${c} "${raw}" must be one of ${allowed.join(', ')}`);
      return undefined;
    };
    f.employmentType = enumCol('employmentType', EMPLOYMENT_TYPES) as EmploymentType | undefined;
    f.taxRegime = enumCol('taxRegime', TAX_REGIMES) as TaxRegime | undefined;
    f.bankAccountType = enumCol('bankAccountType', BANK_ACCOUNT_TYPES) as
      BankAccountType | undefined;

    const workState = get('workState');
    if (workState) {
      const key = toEnumKey(workState);
      if (INDIAN_STATES.has(key)) f.workState = key as IndianState;
      else
        err(`workState "${workState}" is not an Indian state or UT (e.g. KARNATAKA, Tamil Nadu)`);
    }

    const pan = get('pan')?.toUpperCase();
    if (pan) {
      if (PAN_PATTERN.test(pan)) p.pan = pan;
      else err('pan must look like ABCDE1234F');
    }

    const aadhaar = get('aadhaarLast4');
    if (aadhaar) {
      if (AADHAAR_LAST4_PATTERN.test(aadhaar)) f.aadhaarLast4 = aadhaar;
      else if (/^\d{12}$/.test(aadhaar.replace(/\s/g, ''))) {
        // Never store (or echo back) a full Aadhaar number — CLAUDE.md.
        err('aadhaarLast4 holds a full Aadhaar number — enter only the last 4 digits');
      } else err('aadhaarLast4 must be exactly 4 digits');
    }

    const uan = get('uan');
    if (uan) {
      if (UAN_PATTERN.test(uan)) f.uan = uan;
      else err('uan must be 12 digits');
    }

    const account = get('bankAccountNumber')?.replace(/\s/g, '');
    if (account) {
      if (BANK_ACCOUNT_PATTERN.test(account)) p.bankAccountNumber = account;
      else err('bankAccountNumber must be 9–18 digits');
    }

    const ifsc = get('bankIfsc')?.toUpperCase();
    if (ifsc) {
      if (IFSC_PATTERN.test(ifsc)) f.bankIfsc = ifsc;
      else err('bankIfsc must look like SBIN0001234');
    }

    p.departmentName = get('department');
    p.managerCode = get('reportingManagerCode');
    if (p.managerCode && p.managerCode === p.code) {
      err('An employee cannot be their own reporting manager');
      p.managerCode = undefined;
    }

    const loginEmail = get('loginEmail')?.toLowerCase();
    const loginRoleRaw = get('loginRole');
    if (loginEmail) {
      const role = (loginRoleRaw ? toEnumKey(loginRoleRaw) : 'EMPLOYEE') as AppRole;
      if (!EMAIL_PATTERN.test(loginEmail)) err(`loginEmail "${loginEmail}" is not a valid email`);
      else if (!LOGIN_ROLES.includes(role)) {
        err(`loginRole "${loginRoleRaw}" must be one of ${LOGIN_ROLES.join(', ')}`);
      } else if (!assignableRoles(actorRole).includes(role)) {
        err(`Only a Company Admin can grant the ${ROLE_LABELS[role]} role`);
      } else if (current?.userId) {
        err('This employee already has a login');
      } else if (takenLoginEmails.has(loginEmail)) {
        err(`loginEmail ${loginEmail} is already used by another login in this workspace`);
      } else {
        p.login = { email: loginEmail, role };
      }
    } else if (loginRoleRaw) {
      p.warnings.push('loginRole is ignored without a loginEmail');
    }

    return p;
  }

  /** The same employee code, or the same login email, twice in one file. */
  private flagDuplicates(planned: PlannedRow[]) {
    const byCode = new Map<string, PlannedRow[]>();
    const byLogin = new Map<string, PlannedRow[]>();
    for (const p of planned) {
      if (p.code) byCode.set(p.code, [...(byCode.get(p.code) ?? []), p]);
      if (p.login) byLogin.set(p.login.email, [...(byLogin.get(p.login.email) ?? []), p]);
    }
    for (const [code, rows] of byCode) {
      if (rows.length < 2) continue;
      const at = rows.map((r) => r.row).join(', ');
      rows.forEach((r) =>
        r.errors.push(`employeeCode ${code} appears more than once (rows ${at})`),
      );
    }
    for (const [email, rows] of byLogin) {
      if (rows.length < 2) continue;
      const at = rows.map((r) => r.row).join(', ');
      rows.forEach((r) => r.errors.push(`loginEmail ${email} appears more than once (rows ${at})`));
    }
  }

  /** A login email already registered with Firebase (e.g. in another workspace) can't be reused. */
  /**
   * PAN / bank account can't be stored without the field-encryption key.
   * Checked up front so the preview says so, instead of every such row
   * passing the dry run and then failing at commit.
   */
  private flagMissingEncryptionKey(planned: PlannedRow[]) {
    const needsKey = planned.filter((p) => p.pan || p.bankAccountNumber);
    if (needsKey.length === 0) return;
    try {
      this.fieldEncryption.encrypt('key-check');
    } catch (e: any) {
      const reason = e?.message ?? 'Field encryption is not available';
      needsKey.forEach((p) =>
        p.errors.push(
          `${reason} Leave pan/bankAccountNumber blank to import this row without them.`,
        ),
      );
    }
  }

  private async flagFirebaseEmailClashes(planned: PlannedRow[]) {
    const toCheck = planned.filter((p) => p.login && p.errors.length === 0);
    await mapWithConcurrency(toCheck, IMPORT_CONCURRENCY, async (p) => {
      try {
        await this.firebaseAuth.getUserByEmail(p.login!.email);
        p.errors.push(`loginEmail ${p.login!.email} is already registered with Firebase`);
      } catch (e: any) {
        if (e?.code !== 'auth/user-not-found') {
          p.errors.push(`Could not check loginEmail ${p.login!.email} with the identity provider`);
        }
      }
    });
  }

  /**
   * A reporting manager may be an existing employee or another row in the
   * same file. Fails a row whose manager is unknown, is itself a failing
   * row, or would close a reporting cycle — repeated until stable, since
   * failing one row can fail the rows that report to it.
   */
  private resolveManagers(planned: PlannedRow[], existing: ExistingEmployee[]) {
    const existingCodeById = new Map(existing.map((e) => [e.id, e.employeeCode]));
    const managerOf = new Map<string, string | undefined>();
    for (const e of existing) {
      managerOf.set(
        e.employeeCode,
        e.reportingManagerId ? existingCodeById.get(e.reportingManagerId) : undefined,
      );
    }
    for (const p of planned) {
      if (p.code && p.errors.length === 0 && p.managerCode) managerOf.set(p.code, p.managerCode);
    }
    const rowByCode = new Map(planned.filter((p) => p.code).map((p) => [p.code!, p]));
    const existingCodes = new Set(existing.map((e) => e.employeeCode));

    let changed = true;
    while (changed) {
      changed = false;
      for (const p of planned) {
        if (p.errors.length > 0 || !p.managerCode) continue;
        const managerRow = rowByCode.get(p.managerCode);
        let problem: string | null = null;
        if (managerRow && managerRow.errors.length > 0) {
          problem = `reportingManagerCode ${p.managerCode} is on row ${managerRow.row}, which has errors`;
        } else if (!managerRow && !existingCodes.has(p.managerCode)) {
          problem = `reportingManagerCode ${p.managerCode} is not an existing employee or a row in this file`;
        } else if (this.closesCycle(p.code!, managerOf)) {
          problem = `reportingManagerCode ${p.managerCode} would create a reporting cycle`;
        }
        if (problem) {
          p.errors.push(problem);
          managerOf.delete(p.code!);
          changed = true;
        }
      }
    }
  }

  private closesCycle(code: string, managerOf: Map<string, string | undefined>) {
    const seen = new Set<string>([code]);
    let cursor = managerOf.get(code);
    while (cursor) {
      if (seen.has(cursor)) return true;
      seen.add(cursor);
      cursor = managerOf.get(cursor);
    }
    return false;
  }

  // ---- Commit ----

  private async commit(
    planned: PlannedRow[],
    actor: AuthenticatedUser,
    departmentByName: Map<string, { id: string; name: string }>,
    newDepartments: string[],
    ignoredColumns: string[],
    onProgress?: OnImportProgress,
  ): Promise<ImportReport> {
    const tenantId = this.tenantPrisma.tenantId;
    const client = this.tenantPrisma.client;

    const createdDepartments: string[] = [];
    for (const name of newDepartments) {
      try {
        const dept = await client.department.create({ data: { tenantId, name } });
        departmentByName.set(name.toLowerCase(), dept);
        createdDepartments.push(name);
      } catch (e) {
        this.logger.error(`Bulk import could not create department "${name}"`, String(e));
      }
    }

    const idByCode = new Map<string, string>();
    const done = new Set<PlannedRow>();
    const audits: AuditLogInput[] = [];
    const accessAudits: Prisma.AuditLogCreateManyInput[] = [];

    // Pass 1: create/update every valid row, a few at a time; managers are
    // left for pass 2 so a manager may appear later in the file than their
    // reports. Each row catches its own failure — one bad row never stops
    // the others.
    const valid = planned.filter((p) => p.errors.length === 0);
    let saved = 0;
    onProgress?.({ phase: 'saving', done: 0, total: valid.length });
    await mapWithConcurrency(valid, IMPORT_CONCURRENCY, async (p) => {
      try {
        const departmentId = p.departmentName
          ? departmentByName.get(p.departmentName.toLowerCase())?.id
          : undefined;
        if (p.departmentName && !departmentId) {
          throw new Error(`Department "${p.departmentName}" could not be created`);
        }
        const written = await this.writeRow(p, departmentId);
        idByCode.set(p.code!, written.employeeId);
        done.add(p);
        audits.push(this.rowAudit(p, written, actor));
        if (written.userId) accessAudits.push(this.loginAudit(p, written.userId, actor));
      } catch (e: any) {
        p.errors.push(this.describeWriteError(e));
      }
      onProgress?.({ phase: 'saving', done: ++saved, total: valid.length });
    });

    // Pass 2: reporting managers, now that every row in the file has an id.
    const existingIdByCode = new Map(
      (await client.employee.findMany({ select: { id: true, employeeCode: true } })).map((e) => [
        e.employeeCode,
        e.id,
      ]),
    );
    const toLink = planned.filter((p) => done.has(p) && p.managerCode);
    let linked = 0;
    onProgress?.({ phase: 'linking', done: 0, total: toLink.length });
    await mapWithConcurrency(toLink, IMPORT_CONCURRENCY, async (p) => {
      const managerId = idByCode.get(p.managerCode!) ?? existingIdByCode.get(p.managerCode!);
      if (!managerId) {
        p.warnings.push(
          `Imported, but reporting manager ${p.managerCode} failed to import — set it later`,
        );
      } else {
        try {
          await client.employee.update({
            where: { id: idByCode.get(p.code!)! },
            data: { reportingManagerId: managerId },
          });
        } catch (e: any) {
          p.warnings.push(`Imported, but setting the reporting manager failed: ${e?.message ?? e}`);
        }
      }
      onProgress?.({ phase: 'linking', done: ++linked, total: toLink.length });
    });

    // Invites last — only for logins whose employee row actually landed.
    const invites = planned.filter((p) => done.has(p) && p.login);
    let invited = 0;
    let invitesFailed = 0;
    onProgress?.({ phase: 'inviting', done: 0, total: invites.length });
    await mapWithConcurrency(invites, IMPORT_CONCURRENCY, async (p) => {
      const email = p.login!.email;
      try {
        await this.authEmails.sendPasswordReset({ email, kind: 'INVITE', tenantId });
      } catch (err) {
        invitesFailed++;
        p.warnings.push(
          'Login created, but the invite email failed — resend it from Access › Users',
        );
        this.logger.error(
          `Bulk import created a login for ${email} but the invite email failed`,
          err instanceof Error ? err.stack : String(err),
        );
      }
      onProgress?.({ phase: 'inviting', done: ++invited, total: invites.length });
    });

    const results = planned.map((p) => this.toResult(p, done.has(p)));
    const doneRows = planned.filter((p) => done.has(p));
    const report = buildReport(false, results, ignoredColumns, {
      created: doneRows.filter((p) => p.action === 'create').length,
      updated: doneRows.filter((p) => p.action === 'update').length,
      logins: invites.length,
      invitesFailed,
      newDepartments: createdDepartments,
    });

    // One batched write for the per-row trail, then the batch summary.
    await this.audit.logMany(audits);
    if (accessAudits.length > 0) {
      try {
        await client.auditLog.createMany({ data: accessAudits });
      } catch (err) {
        this.logger.error(
          `Bulk import created ${accessAudits.length} logins but the access-change audit write failed`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
    await this.audit.log({
      actorUserId: actor.sub,
      action: 'employee.bulk_imported',
      targetType: 'employee',
      metadata: {
        module: 'employee-master',
        actorName: actor.email ?? 'System',
        actorRole: actor.role,
        totalRows: report.totalRows,
        succeeded: report.succeeded,
        failed: report.failed,
        ...report.summary,
      },
    });
    return report;
  }

  /**
   * Writes one row as a single statement — the employee plus, for a login,
   * a nested `users` create — so it's atomic without an interactive
   * transaction. Firebase goes first (a network call, not a DB write); a
   * failed DB write deletes that Firebase login again. Throws on failure,
   * leaving no partial state.
   */
  private async writeRow(
    p: PlannedRow,
    departmentId: string | undefined,
  ): Promise<{ employeeId: string; userId: string | null; fieldsChanged: string[] }> {
    const tenantId = this.tenantPrisma.tenantId;
    const fields: Prisma.EmployeeUpdateInput = { ...p.fields };
    if (p.pan) {
      fields.panCiphertext = this.fieldEncryption.encrypt(p.pan);
      fields.panMasked = maskPan(p.pan);
    }
    if (p.bankAccountNumber) {
      fields.bankAccountCiphertext = this.fieldEncryption.encrypt(p.bankAccountNumber);
      fields.bankAccountMasked = maskBankAccount(p.bankAccountNumber);
    }
    // Blank cells never clear a field: drop every undefined key.
    for (const k of Object.keys(fields)) {
      if ((fields as any)[k] === undefined) delete (fields as any)[k];
    }
    const fieldsChanged = [
      ...Object.keys(fields).filter((k) => !k.endsWith('Ciphertext') && !k.endsWith('Masked')),
      ...(departmentId ? ['departmentId'] : []),
      ...(p.pan ? ['pan'] : []),
      ...(p.bankAccountNumber ? ['bankAccountNumber'] : []),
    ];

    let firebaseUid: string | undefined;
    if (p.login) {
      const created = await this.firebaseAuth.createUser({
        email: p.login.email,
        // Never shown to anyone: the invite email lets them set their own.
        password: randomBytes(24).toString('base64url'),
      });
      firebaseUid = created.uid;
    }

    try {
      if (firebaseUid) {
        await this.firebaseAuth.setCustomUserClaims(firebaseUid, { tenantId, role: p.login!.role });
      }
      const relations = {
        ...(departmentId ? { department: { connect: { id: departmentId } } } : {}),
        ...(firebaseUid
          ? {
              user: {
                create: { tenantId, email: p.login!.email, firebaseUid, role: p.login!.role },
              },
            }
          : {}),
      };
      const select = { id: true, userId: true } as const;
      const written =
        p.action === 'create'
          ? await this.tenantPrisma.client.employee.create({
              data: {
                ...(fields as Prisma.EmployeeCreateInput),
                ...relations,
                tenantId,
                employeeCode: p.code!,
              },
              select,
            })
          : await this.tenantPrisma.client.employee.update({
              where: { id: p.existingId! },
              data: { ...fields, ...relations },
              select,
            });
      return { employeeId: written.id, userId: firebaseUid ? written.userId : null, fieldsChanged };
    } catch (e) {
      if (firebaseUid) {
        await this.firebaseAuth
          .deleteUser(firebaseUid)
          .catch((err) =>
            this.logger.error(
              `Could not delete the Firebase user for ${p.login!.email} after a failed import row — remove it manually`,
              String(err),
            ),
          );
      }
      throw e;
    }
  }

  private rowAudit(
    p: PlannedRow,
    written: { employeeId: string; fieldsChanged: string[] },
    actor: AuthenticatedUser,
  ): AuditLogInput {
    return {
      actorUserId: actor.sub,
      action: p.action === 'create' ? 'employee.created' : 'employee.updated',
      targetType: 'employee',
      targetId: written.employeeId,
      metadata: {
        module: 'employee-master',
        actorName: actor.email ?? 'System',
        actorRole: actor.role,
        source: 'bulk-import',
        // Field names only — never PAN/bank/Aadhaar values.
        fieldsChanged: written.fieldsChanged,
      },
    };
  }

  private loginAudit(
    p: PlannedRow,
    userId: string,
    actor: AuthenticatedUser,
  ): Prisma.AuditLogCreateManyInput {
    return buildAccessAuditData({
      tenantId: this.tenantPrisma.tenantId,
      actorUserId: actor.sub,
      actorName: actor.email ?? 'System',
      actorRole: actor.role,
      action: 'user.created',
      targetUserId: userId,
      targetEmail: p.login!.email,
      after: ROLE_LABELS[p.login!.role] ?? p.login!.role,
      note: 'Login provisioned via employee bulk import.',
    }) as Prisma.AuditLogCreateManyInput;
  }

  private describeWriteError(e: any): string {
    if (e?.code === 'auth/email-already-exists')
      return 'loginEmail is already registered with Firebase';
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return 'An employee or login with these details already exists';
    }
    return e?.message ?? 'Unknown error';
  }

  private toResult(p: PlannedRow, success: boolean): ImportRowResult {
    const detail = [
      p.departmentName ? `Dept: ${p.departmentName}` : null,
      p.managerCode ? `Reports to ${p.managerCode}` : null,
      p.login ? `Login: ${p.login.email} (${ROLE_LABELS[p.login.role]})` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      row: p.row,
      employeeCode: p.code,
      action: p.action,
      success,
      ...(p.errors.length > 0 ? { error: p.errors.join('; ') } : {}),
      ...(p.warnings.length > 0 ? { warnings: p.warnings } : {}),
      ...(detail ? { detail } : {}),
    };
  }
}
