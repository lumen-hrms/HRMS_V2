import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { IndianState, Prisma } from '@prisma/client';
import { randomBytes, randomUUID } from 'crypto';
import type * as admin from 'firebase-admin';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantPrismaClientProvider } from '../prisma/tenant-prisma-client.provider';
import {
  FieldEncryptionService,
  maskBankAccount,
  maskPan,
} from '../crypto/field-encryption.service';
import { FIREBASE_AUTH } from '../firebase/firebase-admin.provider';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import type { AppRole } from '../common/decorators/roles.decorator';
import { buildAccessAuditData, ROLE_LABELS } from '../access/access.support';
import { AuditService, type AuditLogInput } from '../audit/audit.service';
import { AuthEmailService } from '../notifications/auth-email.service';
import {
  EmployeeImportService,
  type ExistingEmployee,
  type PlannedRow,
} from '../employees/employee-import.service';
import { LeaveEntitlementService } from '../leave/leave-entitlement.service';
import { holidayKey, parseHolidaySheet } from '../leave/holiday-import';
import { leaveYearWindow, utcDay } from '../leave/leave-entitlement';
import { resolveLeaveYear } from '../leave/leave-year.util';
import {
  buildReport,
  parseImportDate,
  readSpreadsheet,
  type ImportReport,
  type SheetRow,
} from '../common/bulk-import';
import { normalizeCompanyProfile } from '../tenant-config/company-profile';
import { validateConfig, type ConfigValidationContext } from './setup-validation';
import { validateOpeningBalances, type OpeningBalanceRow } from './opening-balances';
import {
  SUGGESTED_LEAVE_TYPES,
  type DraftFile,
  type SetupDraft,
  type SetupIssue,
} from './setup.types';

export interface LoginFailure {
  employeeCode: string;
  email: string;
  role: AppRole;
  error: string;
}

export interface SetupResult {
  submittedAt: string;
  counts: Record<string, number>;
  loginFailures: LoginFailure[];
}

/** Everything validation needs from the DB, loaded once per call. */
interface TenantSnapshot {
  settings: { fyStartMonth: number; weeklyOffDays: number[] } | null;
  employees: (ExistingEmployee & { gender: string | null })[];
  userEmails: Set<string>;
  lockedMonths: Set<string>;
  actorEmployeeId: string | null;
  /** `employeeCode|TYPECODE` → for the leave year opening balances land in. */
  balanceKeys: (year: number) => Promise<Set<string>>;
  hasBalances: boolean;
}

export interface SetupValidation {
  ok: boolean;
  issues: SetupIssue[];
  employeeReport: ImportReport | null;
  balanceReport: ImportReport | null;
}

const fileKey = { employees: 'employeeFile', balances: 'openingBalanceFile' } as const;

const toSheetRows = (file: DraftFile): SheetRow[] =>
  file.rows.map((r) => ({ row: r.row, values: new Map(Object.entries(r.values)) }));

/** A draft leave type's event-based-leave columns, with ACCRUED defaults. */
function eventFields(t: SetupDraft['leavePolicy']['types'][number]) {
  const onEvent = t.grantMode === 'ON_EVENT';
  return {
    grantMode: onEvent ? ('ON_EVENT' as const) : ('ACCRUED' as const),
    daysPerEvent: onEvent ? (t.daysPerEvent ?? null) : null,
    reducedDaysPerEvent: onEvent ? (t.reducedDaysPerEvent ?? null) : null,
    reducedAfterEvents: onEvent ? (t.reducedAfterEvents ?? null) : null,
    countCalendarDays: onEvent ? !!t.countCalendarDays : false,
    maxEventsPerEmployment: onEvent ? (t.maxEventsPerEmployment ?? null) : null,
    eventLabel: onEvent ? (t.eventLabel?.trim() ?? null) : null,
    eventWindowDaysBefore: onEvent ? (t.eventWindowDaysBefore ?? 0) : 0,
    eventWindowDaysAfter: onEvent ? (t.eventWindowDaysAfter ?? 0) : 0,
    minServiceDays: onEvent ? (t.minServiceDays ?? 0) : 0,
    requiresDocument: onEvent ? !!t.requiresDocument : false,
    statutoryMaternity: onEvent ? !!t.statutoryMaternity : false,
    ...(onEvent ? { annualQuota: 0, carryForwardCap: 0 } : {}),
  };
}

/**
 * Company setup (module 13 "Company setup") — the mandatory first run every
 * tenant's Company Admin completes before anyone can use the app
 * (`TenantGuard` enforces SETUP_INCOMPLETE).
 *
 * The draft is saved whole and encrypted (`FieldEncryptionService`: the
 * employee file can carry PAN/bank numbers) so the admin can stop and resume
 * anywhere. `submit()` re-validates everything — strict: one error anywhere
 * blocks it — and writes every setting, department, shift, holiday, leave
 * type, the admin's own employee record, the imported employees and their
 * opening balances in ONE database transaction: it all lands or none of it
 * does. Firebase logins can't join a DB transaction, so they're provisioned
 * right after the commit; any that fail are kept on the setup record for
 * `retryLogins()`.
 *
 * A returning tenant (one with data from before company setup existed) gets
 * its current config pre-filled; setup only adds and updates, never deletes.
 */
@Injectable()
export class SetupService {
  private readonly logger = new Logger(SetupService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly raw: TenantPrismaClientProvider,
    private readonly fieldEncryption: FieldEncryptionService,
    private readonly importer: EmployeeImportService,
    private readonly entitlement: LeaveEntitlementService,
    private readonly audit: AuditService,
    private readonly authEmails: AuthEmailService,
    @Inject(FIREBASE_AUTH) private readonly firebaseAuth: admin.auth.Auth,
  ) {}

  // ---- Status & draft ----

  async getStatus() {
    const client = this.tenantPrisma.client;
    const setup = await client.tenantSetup.findUnique({
      where: { tenantId: this.tenantPrisma.tenantId },
      select: { completedAt: true, result: true },
    });
    const complete = !!setup?.completedAt;
    const payrollConfigured = complete ? (await client.salaryStructure.count()) > 0 : false;
    const result = setup?.result as SetupResult | null;
    return {
      complete,
      completedAt: setup?.completedAt ?? null,
      payrollConfigured,
      loginFailures: result?.loginFailures ?? [],
    };
  }

  async getDraft(actor: AuthenticatedUser, tenantName: string) {
    const setup = await this.loadSetupRow();
    if (setup?.completedAt) throw new BadRequestException('Company setup is already complete');
    const draft = setup?.draftCiphertext
      ? this.decrypt(setup.draftCiphertext)
      : await this.prefill(actor, tenantName);
    return {
      draft: this.forBrowser(draft),
      savedAt: setup?.draftUpdatedAt ?? null,
      files: {
        employees: this.fileSummary(draft.employeeFile),
        balances: this.fileSummary(draft.openingBalanceFile),
      },
    };
  }

  /**
   * Saves the browser's draft. Uploaded files never travel back from the
   * browser (they hold PII), so the stored ones are kept as they are.
   */
  async saveDraft(actor: AuthenticatedUser, incoming: Partial<SetupDraft>) {
    const setup = await this.assertEditable();
    const stored = setup?.draftCiphertext ? this.decrypt(setup.draftCiphertext) : null;
    const draft = this.sanitize(incoming, stored, await this.savedRows());
    if (
      JSON.stringify({ ...draft.profile, forUserId: undefined }) !==
      JSON.stringify({ ...stored?.profile, forUserId: undefined })
    ) {
      draft.profile.forUserId = actor.sub;
    }
    const savedAt = await this.persist(draft, actor);
    return { savedAt };
  }

  // ---- Uploads ----

  async uploadFile(
    actor: AuthenticatedUser,
    kind: 'employees' | 'balances',
    upload?: { buffer: Buffer; originalname: string },
  ) {
    await this.assertEditable();
    const sheet = await readSpreadsheet(upload?.buffer);
    const draft = await this.currentDraft(actor);
    const file: DraftFile = {
      fileName: upload?.originalname ?? 'upload',
      uploadedAt: new Date().toISOString(),
      headers: sheet.headers,
      rows: sheet.rows.map((r) => ({ row: r.row, values: Object.fromEntries(r.values) })),
    };
    draft[fileKey[kind]] = file;
    await this.persist(draft, actor);
    const validation = await this.validateDraft(draft, actor, { deep: kind === 'employees' });
    return {
      file: this.fileSummary(file),
      report: kind === 'employees' ? validation.employeeReport : validation.balanceReport,
    };
  }

  async removeFile(actor: AuthenticatedUser, kind: 'employees' | 'balances') {
    await this.assertEditable();
    const draft = await this.currentDraft(actor);
    draft[fileKey[kind]] = null;
    // Opening balances can reference employees from the employee file.
    await this.persist(draft, actor);
    return { removed: true };
  }

  /**
   * Holidays from a CSV/XLSX, merged into the draft by date + name (a
   * corrected file updates rows instead of duplicating them). A file with
   * unreadable rows is not merged at all — fix it and upload again.
   */
  async importHolidays(actor: AuthenticatedUser, buffer?: Buffer) {
    await this.assertEditable();
    const sheet = await readSpreadsheet(buffer);
    const { holidays, issues } = parseHolidaySheet(sheet);
    if (issues.some((i) => i.level === 'error')) {
      return { merged: false, added: 0, updated: 0, issues };
    }
    const draft = await this.currentDraft(actor);
    const byKey = new Map(draft.holidays.map((h) => [holidayKey(h), h]));
    let added = 0;
    let updated = 0;
    for (const h of holidays) {
      const current = byKey.get(holidayKey(h));
      if (current) {
        if (!current.existingId && current.optional !== h.optional) {
          current.optional = h.optional;
          updated++;
        }
      } else {
        const fresh = { date: h.date, name: h.name, optional: h.optional };
        draft.holidays.push(fresh);
        byKey.set(holidayKey(fresh), fresh);
        added++;
      }
    }
    draft.holidays.sort((a, b) => a.date.localeCompare(b.date));
    await this.persist(draft, actor);
    return { merged: true, added, updated, issues: [], holidays: draft.holidays };
  }

  // ---- Validation ----

  async validate(actor: AuthenticatedUser): Promise<SetupValidation> {
    const draft = await this.currentDraft(actor);
    return this.validateDraft(draft, actor, { deep: false });
  }

  private async validateDraft(
    draft: SetupDraft,
    actor: AuthenticatedUser,
    opts: { deep: boolean },
  ): Promise<SetupValidation & { planned: PlannedRow[]; balances: OpeningBalanceRow[] }> {
    const snap = await this.snapshot(actor);
    const today = new Date();
    const actorCode = snap.employees.find((e) => e.id === snap.actorEmployeeId)?.employeeCode;
    const ctx: ConfigValidationContext = {
      today,
      lockedMonths: snap.lockedMonths,
      otherEmployeeCodes: new Set(
        snap.employees.map((e) => e.employeeCode).filter((c) => c !== actorCode),
      ),
      hasExistingBalances: snap.hasBalances,
      savedFyStartMonth: snap.settings?.fyStartMonth ?? 4,
    };
    const issues = validateConfig(draft, ctx);
    if (
      !draft.profile.notAnEmployee &&
      draft.profile.forUserId &&
      draft.profile.forUserId !== actor.sub
    ) {
      issues.push({
        step: 'profile',
        level: 'error',
        message:
          'This profile was filled in by another Company Admin. Review it and save it as your own before submitting.',
      });
    }

    const adminCode = draft.profile.notAnEmployee
      ? null
      : draft.profile.employeeCode?.trim() || null;

    // Employee file
    let employeeReport: ImportReport | null = null;
    let planned: PlannedRow[] = [];
    if (draft.employeeFile) {
      const existing: ExistingEmployee[] = [...snap.employees];
      if (adminCode && !snap.employees.some((e) => e.employeeCode === adminCode)) {
        existing.push({
          id: '__admin__',
          employeeCode: adminCode,
          reportingManagerId: null,
          userId: actor.sub,
        });
      }
      const result = await this.importer.plan(
        toSheetRows(draft.employeeFile),
        draft.employeeFile.headers,
        {
          existing,
          departmentNames: draft.departments.map((d) => d.name),
          takenLoginEmails: snap.userEmails,
          actorRole: 'COMPANY_ADMIN',
          strictDepartments: true,
          reservedCodes: adminCode
            ? new Map([
                [
                  adminCode,
                  `employeeCode ${adminCode} is your own profile — remove this row, step 2 already creates it`,
                ],
              ])
            : undefined,
          checkFirebase: opts.deep,
        },
      );
      planned = result.planned;
      const results = planned.map((p) => this.importer.toResult(p, p.errors.length === 0));
      employeeReport = buildReport(true, results, result.ignoredColumns, {
        create: planned.filter((p) => p.errors.length === 0 && p.action === 'create').length,
        update: planned.filter((p) => p.errors.length === 0 && p.action === 'update').length,
        logins: planned.filter((p) => p.errors.length === 0 && p.login).length,
      });
      for (const p of planned) {
        for (const e of p.errors)
          issues.push({ step: 'employees', level: 'error', row: p.row, message: e });
        for (const w of p.warnings)
          issues.push({ step: 'employees', level: 'warning', row: p.row, message: w });
      }
    }

    // Opening balances
    let balanceReport: ImportReport | null = null;
    let balances: OpeningBalanceRow[] = [];
    if (draft.openingBalanceFile) {
      const employees = new Map<string, { gender: string | null }>();
      for (const e of snap.employees) employees.set(e.employeeCode, { gender: e.gender });
      for (const p of planned) {
        if (p.errors.length === 0 && p.code)
          employees.set(p.code, {
            gender: p.fields.gender ?? employees.get(p.code)?.gender ?? null,
          });
      }
      if (adminCode) employees.set(adminCode, { gender: draft.profile.gender || null });
      const types = new Map(
        draft.leavePolicy.types.map((t) => [
          t.code.trim().toUpperCase(),
          {
            name: t.name,
            genderRestriction: t.genderRestriction,
            annualQuota: t.annualQuota,
            carryForwardCap: t.carryForwardCap,
            isCompOff: t.isCompOff,
            onEvent: t.grantMode === 'ON_EVENT',
          },
        ]),
      );
      const year = this.openingYear(draft, today);
      const result = validateOpeningBalances(toSheetRows(draft.openingBalanceFile), {
        employees,
        types,
        existingBalances: year === null ? new Set() : await snap.balanceKeys(year),
      });
      balances = result.valid;
      balanceReport = buildReport(true, result.results, [], { create: result.valid.length });
      for (const r of result.results) {
        if (r.error)
          issues.push({ step: 'balances', level: 'error', row: r.row, message: r.error });
        for (const w of r.warnings ?? [])
          issues.push({ step: 'balances', level: 'warning', row: r.row, message: w });
      }
    }

    return {
      ok: !issues.some((i) => i.level === 'error'),
      issues,
      employeeReport,
      balanceReport,
      planned,
      balances,
    };
  }

  // ---- Submit ----

  async submit(actor: AuthenticatedUser) {
    const setup = await this.assertEditable();
    const draft = setup?.draftCiphertext ? this.decrypt(setup.draftCiphertext) : null;
    if (!draft) throw new BadRequestException('Save your setup before submitting it');
    const validation = await this.validateDraft(draft, actor, { deep: true });
    if (!validation.ok) {
      throw new BadRequestException({
        message: 'Setup has errors — fix them before submitting',
        issues: validation.issues.filter((i) => i.level === 'error'),
      });
    }

    const tenantId = this.tenantPrisma.tenantId;
    const now = new Date();
    const valid = validation.planned.filter((p) => p.errors.length === 0);
    const employeeIdByCode = new Map<string, string>();
    let adminEmployeeId: string | null = null;
    const counts: Record<string, number> = {};

    await this.raw.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, TRUE)`;
        // Claim the submit first: the row lock makes a double-click (or two
        // admins) wait here, then fail, instead of writing everything twice.
        const claimed = await tx.tenantSetup.updateMany({
          where: { tenantId, completedAt: null },
          data: { completedAt: now, completedBy: actor.sub },
        });
        if (claimed.count === 0) throw new BadRequestException('Company setup is already complete');

        const company = normalizeCompanyProfile(draft.company);
        await tx.companyProfile.upsert({
          where: { tenantId },
          update: company,
          create: { tenantId, ...company },
        });

        const goLiveDate = new Date(parseImportDate(draft.goLiveDate)!);
        const settingsData = {
          timezone: draft.workWeek.timezone,
          weeklyOffDays: draft.workWeek.weeklyOffDays,
          payrollCutoffDay: draft.attendance.payrollCutoffDay,
          fyStartMonth: draft.leavePolicy.fyStartMonth,
          leaveApprovalLevels: draft.leavePolicy.leaveApprovalLevels,
          leaveEscalationDays: draft.leavePolicy.leaveEscalationDays,
          allowLopRequests: draft.leavePolicy.allowLopRequests,
          goLiveDate,
        };
        await tx.tenantSettings.upsert({
          where: { tenantId },
          update: settingsData,
          create: { tenantId, ...settingsData },
        });
        const attendanceData = {
          mode: draft.attendance.mode,
          captureMethods: draft.attendance.captureMethods,
          regularizationWindowDays: draft.attendance.regularizationWindowDays,
          regularizationMonthlyCap: draft.attendance.regularizationMonthlyCap,
          unactionedBehavior: draft.attendance.unactionedBehavior,
        };
        await tx.attendanceSettings.upsert({
          where: { tenantId },
          update: attendanceData,
          create: { tenantId, ...attendanceData },
        });

        // Departments — add the new ones, keep every existing one.
        const existingDepts = await tx.department.findMany({ select: { id: true, name: true } });
        const deptIdByName = new Map(existingDepts.map((d) => [d.name.toLowerCase(), d.id]));
        let departmentsCreated = 0;
        for (const d of draft.departments) {
          const k = d.name.trim().toLowerCase();
          if (d.existingId || deptIdByName.has(k)) continue;
          const created = await tx.department.create({
            data: { tenantId, name: d.name.trim(), code: d.code?.trim() || null },
          });
          deptIdByName.set(k, created.id);
          departmentsCreated++;
        }
        counts.departmentsCreated = departmentsCreated;

        // Shifts — update existing, create new, then exactly one default.
        let defaultShiftId: string | null = null;
        for (const s of draft.shifts) {
          const data = {
            name: s.name.trim(),
            type: s.type,
            startTime: s.startTime,
            endTime: s.endTime,
            graceMinutes: s.graceMinutes,
            minHoursFullDay: s.minHoursFullDay,
            minHoursHalfDay: s.minHoursHalfDay,
            coreStartTime: s.type === 'FLEXI' ? s.coreStartTime : null,
            coreEndTime: s.type === 'FLEXI' ? s.coreEndTime : null,
            isDefault: false,
          };
          const row = s.existingId
            ? await tx.shift.update({ where: { id: s.existingId }, data })
            : await tx.shift.create({ data: { tenantId, ...data } });
          if (s.isDefault) defaultShiftId = row.id;
        }
        await tx.shift.updateMany({
          where: { id: { not: defaultShiftId! } },
          data: { isDefault: false },
        });
        await tx.shift.update({ where: { id: defaultShiftId! }, data: { isDefault: true } });

        // Holidays — only the new ones; saved ones are managed in Leave › Holidays.
        const newHolidays = draft.holidays.filter((h) => !h.existingId);
        if (newHolidays.length > 0) {
          await tx.holiday.createMany({
            data: newHolidays.map((h) => ({
              tenantId,
              date: new Date(h.date),
              name: h.name.trim(),
              isOptional: h.optional,
            })),
            skipDuplicates: true,
          });
        }
        counts.holidaysCreated = newHolidays.length;

        // Leave types — update existing, create new.
        const typeIdByCode = new Map<string, string>();
        for (const t of draft.leavePolicy.types) {
          const data = {
            name: t.name.trim(),
            code: t.code.trim().toUpperCase(),
            colorToken: t.colorToken || '#2b5a8c',
            annualQuota: t.annualQuota,
            carryForwardCap: t.carryForwardCap,
            minNoticeDays: t.minNoticeDays,
            accrualFrequency: t.accrualFrequency,
            genderRestriction: t.genderRestriction,
            paid: t.paid,
            requiresApproval: t.requiresApproval,
            isCompOff: t.isCompOff,
            isRestrictedHoliday: t.isRestrictedHoliday,
            ...eventFields(t),
          };
          const row = t.existingId
            ? await tx.leaveType.update({ where: { id: t.existingId }, data })
            : await tx.leaveType.create({ data: { tenantId, ...data } });
          typeIdByCode.set(data.code, row.id);
        }

        // The admin's own employee record, linked to their login.
        const existingEmployees = await tx.employee.findMany({
          select: { id: true, employeeCode: true, userId: true },
        });
        for (const e of existingEmployees) employeeIdByCode.set(e.employeeCode, e.id);
        const p = draft.profile;
        if (!p.notAnEmployee) {
          const data = {
            employeeCode: p.employeeCode.trim(),
            firstName: p.firstName.trim(),
            lastName: p.lastName.trim(),
            designation: p.designation?.trim() || null,
            departmentId: deptIdByName.get(p.departmentName.trim().toLowerCase()) ?? null,
            dateOfJoining: new Date(parseImportDate(p.dateOfJoining)!),
            gender: p.gender?.trim() || null,
            workState: (p.workState || null) as IndianState | null,
            phone: p.phone?.trim() || null,
          };
          const mine = existingEmployees.find((e) => e.userId === actor.sub);
          const row = mine
            ? await tx.employee.update({ where: { id: mine.id }, data })
            : await tx.employee.create({ data: { tenantId, userId: actor.sub, ...data } });
          adminEmployeeId = row.id;
          employeeIdByCode.set(data.employeeCode, row.id);
        }

        // Imported employees: creates in manager-first order so every
        // reporting line points at a row that's already there.
        const creates = this.managerFirst(valid.filter((r) => r.action === 'create'));
        for (const r of creates) employeeIdByCode.set(r.code!, randomUUID());
        const createRows = creates.map((r) => ({
          ...this.employeeData(r, deptIdByName),
          id: employeeIdByCode.get(r.code!)!,
          tenantId,
          employeeCode: r.code!,
          firstName: r.fields.firstName!,
          lastName: r.fields.lastName!,
          reportingManagerId: r.managerCode ? (employeeIdByCode.get(r.managerCode) ?? null) : null,
        }));
        for (let i = 0; i < createRows.length; i += 500) {
          await tx.employee.createMany({ data: createRows.slice(i, i + 500) });
        }
        for (const r of valid.filter((x) => x.action === 'update')) {
          await tx.employee.update({
            where: { id: r.existingId! },
            data: {
              ...this.employeeData(r, deptIdByName),
              ...(r.managerCode
                ? { reportingManagerId: employeeIdByCode.get(r.managerCode) ?? null }
                : {}),
            },
          });
        }
        counts.employeesCreated = creates.length;
        counts.employeesUpdated = valid.length - creates.length;

        // Opening balances, then whatever the policy owes everyone else.
        const openingDate = this.openingDate(draft, now)!;
        const openingYear = resolveLeaveYear(openingDate, draft.leavePolicy.fyStartMonth);
        if (validation.balances.length > 0) {
          const rows = validation.balances.map((b) => ({
            employeeId: employeeIdByCode.get(b.employeeCode)!,
            leaveTypeId: typeIdByCode.get(b.leaveTypeCode)!,
            amount: b.amount,
          }));
          await tx.leaveBalance.createMany({
            data: rows.map((b) => ({
              tenantId,
              employeeId: b.employeeId,
              leaveTypeId: b.leaveTypeId,
              year: openingYear,
              accrued: b.amount,
              used: 0,
            })),
          });
          await tx.leaveLedgerEntry.createMany({
            data: rows.map((b) => ({
              tenantId,
              employeeId: b.employeeId,
              leaveTypeId: b.leaveTypeId,
              delta: b.amount,
              balanceAfter: b.amount,
              source: 'OPENING_BALANCE' as const,
              note: 'Opening balance imported at company setup',
              occurredAt: openingDate,
              actorUserId: actor.sub,
            })),
          });
        }
        counts.openingBalances = validation.balances.length;
        const credited = await this.entitlement.applyPolicyDefaults(tx, tenantId, now);
        counts.policyCredits = credited.credited;

        await tx.tenantSetup.update({
          where: { tenantId },
          data: {
            draftCiphertext: null,
            result: {
              submittedAt: now.toISOString(),
              counts,
              loginFailures: [],
            } as unknown as Prisma.InputJsonValue,
          },
        });
      },
      { timeout: 180_000, maxWait: 15_000 },
    );

    // ---- After the commit: logins, invites, audit ----
    const loginFailures: LoginFailure[] = [];
    const logins = valid.filter((r) => r.login);
    const accessAudits: Prisma.AuditLogCreateManyInput[] = [];
    for (const r of logins) {
      const failure = await this.provisionLogin(
        employeeIdByCode.get(r.code!)!,
        r.code!,
        r.login!.email,
        r.login!.role,
        actor,
        accessAudits,
      );
      if (failure) loginFailures.push(failure);
    }
    counts.logins = logins.length - loginFailures.length;
    await this.tenantPrisma.client.tenantSetup.update({
      where: { tenantId },
      data: {
        result: {
          submittedAt: now.toISOString(),
          counts,
          loginFailures,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    const audits: AuditLogInput[] = valid.map((r) => ({
      actorUserId: actor.sub,
      action: r.action === 'create' ? 'employee.created' : 'employee.updated',
      targetType: 'employee',
      targetId: employeeIdByCode.get(r.code!) ?? null,
      metadata: {
        module: 'employee-master',
        actorName: actor.email,
        actorRole: actor.role,
        source: 'company-setup',
        fieldsChanged: Object.keys(r.fields).filter((k) => (r.fields as any)[k] !== undefined),
      },
    }));
    await this.audit.logMany(audits);
    if (accessAudits.length > 0) {
      await this.tenantPrisma.client.auditLog
        .createMany({ data: accessAudits })
        .catch((err) => this.logger.error('Company setup: login audit write failed', String(err)));
    }
    await this.audit.log({
      actorUserId: actor.sub,
      action: 'tenant.setup_completed',
      targetType: 'tenant',
      targetId: tenantId,
      metadata: {
        module: 'tenant-configuration',
        actorName: actor.email,
        actorRole: actor.role,
        goLiveDate: draft.goLiveDate,
        adminEmployeeId,
        ...counts,
        loginFailures: loginFailures.length,
      },
    });

    return { complete: true, counts, loginFailures };
  }

  /** Re-tries every login that failed after the submit; returns what's still failing. */
  async retryLogins(actor: AuthenticatedUser) {
    const client = this.tenantPrisma.client;
    const setup = await this.loadSetupRow();
    if (!setup?.completedAt) throw new BadRequestException('Submit company setup first');
    const result = (setup.result as SetupResult | null) ?? {
      submittedAt: '',
      counts: {},
      loginFailures: [],
    };
    const stillFailing: LoginFailure[] = [];
    const accessAudits: Prisma.AuditLogCreateManyInput[] = [];
    for (const f of result.loginFailures) {
      const employee = await client.employee.findFirst({
        where: { employeeCode: f.employeeCode },
        select: { id: true, userId: true },
      });
      if (!employee || employee.userId) continue; // gone, or linked another way since
      const failure = await this.provisionLogin(
        employee.id,
        f.employeeCode,
        f.email,
        f.role,
        actor,
        accessAudits,
      );
      if (failure) stillFailing.push(failure);
    }
    await client.tenantSetup.update({
      where: { tenantId: this.tenantPrisma.tenantId },
      data: {
        result: { ...result, loginFailures: stillFailing } as unknown as Prisma.InputJsonValue,
      },
    });
    if (accessAudits.length > 0) {
      await client.auditLog
        .createMany({ data: accessAudits })
        .catch((err) => this.logger.error('Company setup: login audit write failed', String(err)));
    }
    return { loginFailures: stillFailing };
  }

  // ---- Helpers ----

  /**
   * Firebase user + claims + `users` row + link + invite, for one imported
   * employee. Returns a failure instead of throwing; a Firebase user whose DB
   * write failed is deleted again so a retry starts clean.
   */
  private async provisionLogin(
    employeeId: string,
    employeeCode: string,
    email: string,
    role: AppRole,
    actor: AuthenticatedUser,
    accessAudits: Prisma.AuditLogCreateManyInput[],
  ): Promise<LoginFailure | null> {
    const tenantId = this.tenantPrisma.tenantId;
    let uid: string | undefined;
    try {
      const created = await this.firebaseAuth.createUser({
        email,
        password: randomBytes(24).toString('base64url'),
      });
      uid = created.uid;
      await this.firebaseAuth.setCustomUserClaims(uid, { tenantId, role });
      const user = await this.tenantPrisma.client.user.create({
        data: { tenantId, email, firebaseUid: uid, role },
      });
      await this.tenantPrisma.client.employee.update({
        where: { id: employeeId },
        data: { userId: user.id },
      });
      accessAudits.push(
        buildAccessAuditData({
          tenantId,
          actorUserId: actor.sub,
          actorName: actor.email,
          actorRole: actor.role,
          action: 'user.created',
          targetUserId: user.id,
          targetEmail: email,
          after: ROLE_LABELS[role] ?? role,
          note: 'Login provisioned via company setup.',
        }) as Prisma.AuditLogCreateManyInput,
      );
    } catch (err: any) {
      if (uid) await this.firebaseAuth.deleteUser(uid).catch(() => undefined);
      const error =
        err?.code === 'auth/email-already-exists'
          ? 'This email is already registered with the identity provider'
          : (err?.message ?? 'Unknown error');
      this.logger.error(`Company setup: login for ${email} failed`, String(err));
      return { employeeCode, email, role, error };
    }
    try {
      await this.authEmails.sendPasswordReset({ email, kind: 'INVITE', tenantId });
    } catch (err) {
      // The login exists; the invite can be resent from Access › Users.
      this.logger.error(`Company setup: invite email to ${email} failed`, String(err));
    }
    return null;
  }

  /** Plain Employee columns + encrypted PAN/bank for one planned import row. */
  private employeeData(r: PlannedRow, deptIdByName: Map<string, string>) {
    const data: Record<string, unknown> = {};
    // Blank cells never clear a field on an update: only defined values are written.
    for (const [k, v] of Object.entries(r.fields)) if (v !== undefined) data[k] = v;
    if (r.departmentName) data.departmentId = deptIdByName.get(r.departmentName.toLowerCase());
    if (r.pan) {
      data.panCiphertext = this.fieldEncryption.encrypt(r.pan);
      data.panMasked = maskPan(r.pan);
    }
    if (r.bankAccountNumber) {
      data.bankAccountCiphertext = this.fieldEncryption.encrypt(r.bankAccountNumber);
      data.bankAccountMasked = maskBankAccount(r.bankAccountNumber);
    }
    return data as Prisma.EmployeeCreateManyInput;
  }

  /** Orders creates so a manager in the same file always comes before their reports. */
  private managerFirst(rows: PlannedRow[]): PlannedRow[] {
    const byCode = new Map(rows.map((r) => [r.code!, r]));
    const depth = new Map<string, number>();
    const depthOf = (code: string, seen = new Set<string>()): number => {
      if (depth.has(code)) return depth.get(code)!;
      const manager = byCode.get(code)?.managerCode;
      // Cycles were rejected during validation; `seen` is just a guard.
      const d =
        manager && byCode.has(manager) && !seen.has(manager)
          ? depthOf(manager, seen.add(code)) + 1
          : 0;
      depth.set(code, d);
      return d;
    };
    return [...rows].sort((a, b) => depthOf(a.code!) - depthOf(b.code!));
  }

  /**
   * Opening balances are "as of go-live" — or the start of the current leave
   * year, for a returning tenant whose go-live is further back than that.
   */
  private openingDate(draft: SetupDraft, today: Date): Date | null {
    const iso = parseImportDate(draft.goLiveDate ?? '');
    const fy = draft.leavePolicy?.fyStartMonth;
    if (!iso || !(fy >= 1 && fy <= 12)) return null;
    const goLive = new Date(iso);
    const window = leaveYearWindow(resolveLeaveYear(utcDay(today), fy), fy);
    return goLive < window.start ? window.start : goLive;
  }

  private openingYear(draft: SetupDraft, today: Date): number | null {
    const date = this.openingDate(draft, today);
    return date ? resolveLeaveYear(date, draft.leavePolicy.fyStartMonth) : null;
  }

  private async snapshot(actor: AuthenticatedUser): Promise<TenantSnapshot> {
    const client = this.tenantPrisma.client;
    const [settings, employees, users, lockedRuns, balanceCount] = await Promise.all([
      client.tenantSettings.findUnique({ where: { tenantId: this.tenantPrisma.tenantId } }),
      client.employee.findMany({
        select: {
          id: true,
          employeeCode: true,
          reportingManagerId: true,
          userId: true,
          gender: true,
        },
      }),
      client.user.findMany({ select: { email: true } }),
      client.payrollRun.findMany({
        where: { status: { in: ['PROCESSED', 'DISBURSED'] } },
        select: { period: true },
      }),
      client.leaveBalance.count(),
    ]);
    return {
      settings,
      employees,
      userEmails: new Set(users.map((u) => u.email.toLowerCase())),
      lockedMonths: new Set(lockedRuns.map((r) => r.period)),
      actorEmployeeId: employees.find((e) => e.userId === actor.sub)?.id ?? null,
      hasBalances: balanceCount > 0,
      balanceKeys: async (year: number) => {
        if (balanceCount === 0) return new Set();
        const rows = await client.leaveBalance.findMany({
          where: { year },
          select: {
            employee: { select: { employeeCode: true } },
            leaveType: { select: { code: true } },
          },
        });
        return new Set(
          rows.map((b) => `${b.employee.employeeCode}|${b.leaveType.code.toUpperCase()}`),
        );
      },
    };
  }

  /** A returning tenant's current config, or sensible defaults for a new one. */
  private async prefill(actor: AuthenticatedUser, tenantName: string): Promise<SetupDraft> {
    const client = this.tenantPrisma.client;
    const tenantId = this.tenantPrisma.tenantId;
    const [settings, attendance, profile, departments, shifts, holidays, types, mine] =
      await Promise.all([
        client.tenantSettings.findUnique({ where: { tenantId } }),
        client.attendanceSettings.findUnique({ where: { tenantId } }),
        client.companyProfile.findUnique({ where: { tenantId } }),
        client.department.findMany({ orderBy: { name: 'asc' } }),
        client.shift.findMany({ orderBy: { createdAt: 'asc' } }),
        client.holiday.findMany({ orderBy: { date: 'asc' } }),
        client.leaveType.findMany({ orderBy: { createdAt: 'asc' } }),
        client.employee.findFirst({ where: { userId: actor.sub }, include: { department: true } }),
      ]);
    const fy = settings?.fyStartMonth ?? 4;
    const today = utcDay(new Date());
    const window = leaveYearWindow(resolveLeaveYear(today, fy), fy);
    const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');
    return {
      version: 1,
      goLiveDate: iso(settings?.goLiveDate) || iso(today),
      company: profile
        ? {
            ...profile,
            addressLine2: profile.addressLine2 ?? '',
            gstin: profile.gstin ?? '',
            cin: profile.cin ?? '',
          }
        : {
            legalName: tenantName,
            addressLine1: '',
            addressLine2: '',
            city: '',
            state: '',
            pincode: '',
            contactEmail: actor.email,
            contactPhone: '',
            gstin: '',
            cin: '',
          },
      profile: {
        notAnEmployee: false,
        forUserId: actor.sub,
        employeeCode: mine?.employeeCode ?? '',
        firstName: mine?.firstName ?? '',
        lastName: mine?.lastName ?? '',
        designation: mine?.designation ?? '',
        departmentName: mine?.department?.name ?? '',
        dateOfJoining: iso(mine?.dateOfJoining),
        gender: mine?.gender ?? '',
        workState: mine?.workState ?? '',
        phone: mine?.phone ?? '',
      },
      departments: departments.map((d) => ({ existingId: d.id, name: d.name, code: d.code ?? '' })),
      workWeek: {
        timezone: settings?.timezone ?? 'Asia/Kolkata',
        weeklyOffDays: settings?.weeklyOffDays ?? [0, 6],
      },
      shifts:
        shifts.length > 0
          ? shifts.map((s) => ({
              existingId: s.id,
              name: s.name,
              type: s.type,
              startTime: s.startTime,
              endTime: s.endTime,
              graceMinutes: s.graceMinutes,
              minHoursFullDay: Number(s.minHoursFullDay),
              minHoursHalfDay: Number(s.minHoursHalfDay),
              coreStartTime: s.coreStartTime ?? undefined,
              coreEndTime: s.coreEndTime ?? undefined,
              isDefault: s.isDefault,
            }))
          : [
              {
                name: 'General',
                type: 'FIXED',
                startTime: '09:00',
                endTime: '18:00',
                graceMinutes: 15,
                minHoursFullDay: 8,
                minHoursHalfDay: 4,
                isDefault: true,
              },
            ],
      attendance: {
        mode: attendance?.mode ?? 'SELF_SERVICE',
        captureMethods: (attendance?.captureMethods ?? [
          'WEB',
        ]) as SetupDraft['attendance']['captureMethods'],
        regularizationWindowDays: attendance?.regularizationWindowDays ?? 7,
        regularizationMonthlyCap: attendance?.regularizationMonthlyCap ?? 3,
        unactionedBehavior: attendance?.unactionedBehavior ?? 'AUTO_APPROVE',
        payrollCutoffDay: settings?.payrollCutoffDay ?? 25,
      },
      holidays: holidays
        .filter((h) => h.date >= window.start)
        .map((h) => ({
          existingId: h.id,
          date: iso(h.date),
          name: h.name,
          optional: h.isOptional,
        })),
      leavePolicy: {
        fyStartMonth: fy,
        leaveApprovalLevels: (settings?.leaveApprovalLevels ?? 2) as 1 | 2,
        leaveEscalationDays: settings?.leaveEscalationDays ?? 3,
        allowLopRequests: settings?.allowLopRequests ?? true,
        types:
          types.length > 0
            ? types.map((t) => ({
                existingId: t.id,
                name: t.name,
                code: t.code,
                colorToken: t.colorToken,
                annualQuota: Number(t.annualQuota),
                carryForwardCap: Number(t.carryForwardCap),
                minNoticeDays: t.minNoticeDays,
                accrualFrequency: t.accrualFrequency,
                genderRestriction: t.genderRestriction,
                paid: t.paid,
                requiresApproval: t.requiresApproval,
                isCompOff: t.isCompOff,
                isRestrictedHoliday: t.isRestrictedHoliday,
                grantMode: t.grantMode,
                daysPerEvent: t.daysPerEvent === null ? null : Number(t.daysPerEvent),
                reducedDaysPerEvent:
                  t.reducedDaysPerEvent === null ? null : Number(t.reducedDaysPerEvent),
                reducedAfterEvents: t.reducedAfterEvents,
                countCalendarDays: t.countCalendarDays,
                maxEventsPerEmployment: t.maxEventsPerEmployment,
                eventLabel: t.eventLabel,
                eventWindowDaysBefore: t.eventWindowDaysBefore,
                eventWindowDaysAfter: t.eventWindowDaysAfter,
                minServiceDays: t.minServiceDays,
                requiresDocument: t.requiresDocument,
                statutoryMaternity: t.statutoryMaternity,
              }))
            : SUGGESTED_LEAVE_TYPES.map((t) => ({ ...t })),
      },
      employeeFile: null,
      openingBalanceFile: null,
    };
  }

  /**
   * Coerces what the browser sent into a complete draft. Shape only — the
   * business rules run in `validateConfig`. Files and server-owned fields
   * come from the stored draft, never the request.
   */
  private sanitize(
    incoming: Partial<SetupDraft>,
    stored: SetupDraft | null,
    saved: Awaited<ReturnType<SetupService['savedRows']>>,
  ): SetupDraft {
    if (!incoming || typeof incoming !== 'object') throw new BadRequestException('Invalid draft');
    const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
    const obj = <T extends object>(v: unknown, fallback: T): T =>
      v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : fallback;
    // A browser can't invent an `existingId`: only ids of rows that really
    // exist survive, anything else is treated as a new row.
    const known = <T extends { existingId?: string }>(rows: T[], ids: Set<string>) =>
      rows.map((r) =>
        r.existingId && !ids.has(r.existingId) ? { ...r, existingId: undefined } : r,
      );
    const profile = obj(incoming.profile, {} as SetupDraft['profile']);
    return {
      version: 1,
      goLiveDate: String(incoming.goLiveDate ?? ''),
      company: obj(incoming.company, {}),
      profile: { ...profile, forUserId: stored?.profile?.forUserId },
      // Saved departments and holidays aren't edited by setup, so they always
      // reflect the DB; the browser only contributes new ones.
      departments: [
        ...saved.departments,
        ...arr<SetupDraft['departments'][number]>(incoming.departments).filter(
          (d) => !d.existingId,
        ),
      ],
      workWeek: obj(incoming.workWeek, { timezone: 'Asia/Kolkata', weeklyOffDays: [] }),
      shifts: known(arr(incoming.shifts), saved.shiftIds),
      attendance: obj(incoming.attendance, {} as SetupDraft['attendance']),
      holidays: [
        ...saved.holidays,
        ...arr<SetupDraft['holidays'][number]>(incoming.holidays).filter((h) => !h.existingId),
      ].sort((a, b) => a.date.localeCompare(b.date)),
      leavePolicy: {
        ...obj(incoming.leavePolicy, {} as SetupDraft['leavePolicy']),
        types: known(arr(incoming.leavePolicy?.types), saved.typeIds),
      },
      employeeFile: stored?.employeeFile ?? null,
      openingBalanceFile: stored?.openingBalanceFile ?? null,
    };
  }

  /** Rows that already exist in the tenant, as the draft shows them. */
  private async savedRows() {
    const client = this.tenantPrisma.client;
    const [departments, holidays, shifts, types, settings] = await Promise.all([
      client.department.findMany({ orderBy: { name: 'asc' } }),
      client.holiday.findMany({ orderBy: { date: 'asc' } }),
      client.shift.findMany({ select: { id: true } }),
      client.leaveType.findMany({ select: { id: true } }),
      client.tenantSettings.findUnique({ where: { tenantId: this.tenantPrisma.tenantId } }),
    ]);
    const fy = settings?.fyStartMonth ?? 4;
    const window = leaveYearWindow(resolveLeaveYear(utcDay(new Date()), fy), fy);
    return {
      departments: departments.map((d) => ({ existingId: d.id, name: d.name, code: d.code ?? '' })),
      holidays: holidays
        .filter((h) => h.date >= window.start)
        .map((h) => ({
          existingId: h.id,
          date: h.date.toISOString().slice(0, 10),
          name: h.name,
          optional: h.isOptional,
        })),
      shiftIds: new Set(shifts.map((x) => x.id)),
      typeIds: new Set(types.map((x) => x.id)),
    };
  }

  /** The draft minus uploaded rows — those hold PII and stay server-side. */
  private forBrowser(draft: SetupDraft): Omit<SetupDraft, 'employeeFile' | 'openingBalanceFile'> {
    const rest: Partial<SetupDraft> = { ...draft };
    delete rest.employeeFile;
    delete rest.openingBalanceFile;
    return rest as Omit<SetupDraft, 'employeeFile' | 'openingBalanceFile'>;
  }

  private fileSummary(file: DraftFile | null) {
    return file
      ? { fileName: file.fileName, uploadedAt: file.uploadedAt, rowCount: file.rows.length }
      : null;
  }

  private loadSetupRow() {
    return this.tenantPrisma.client.tenantSetup.findUnique({
      where: { tenantId: this.tenantPrisma.tenantId },
    });
  }

  private async assertEditable() {
    const setup = await this.loadSetupRow();
    if (setup?.completedAt) throw new ForbiddenException('Company setup is already complete');
    return setup;
  }

  /** The stored draft, or a fresh prefill saved as the first draft. */
  private async currentDraft(actor: AuthenticatedUser): Promise<SetupDraft> {
    const setup = await this.loadSetupRow();
    if (setup?.draftCiphertext) return this.decrypt(setup.draftCiphertext);
    const draft = await this.prefill(actor, '');
    await this.persist(draft, actor);
    return draft;
  }

  private async persist(draft: SetupDraft, actor: AuthenticatedUser): Promise<Date> {
    const tenantId = this.tenantPrisma.tenantId;
    const now = new Date();
    const data = {
      draftCiphertext: this.fieldEncryption.encrypt(JSON.stringify(draft)),
      draftUpdatedAt: now,
      draftUpdatedBy: actor.sub,
    };
    await this.tenantPrisma.client.tenantSetup.upsert({
      where: { tenantId },
      update: data,
      create: { tenantId, ...data },
    });
    return now;
  }

  private decrypt(ciphertext: string): SetupDraft {
    return JSON.parse(this.fieldEncryption.decrypt(ciphertext)) as SetupDraft;
  }
}
