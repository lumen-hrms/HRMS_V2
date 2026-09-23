import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { LeaveService } from '../leave/leave.service';
import { DocumentsService } from '../documents/documents.service';
import { HR_ROLES, NotificationDispatcher } from '../notifications/notification-dispatcher.service';
import { recursiveReportIds as recursiveReportIdsPure } from '../common/reporting-hierarchy';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import type {
  CreateRegularizationDto,
  CreateShiftDto,
  MarkAttendanceDto,
  UpdateAttendanceSettingsDto,
  UpdateShiftDto,
} from './dto/attendance.dto';
import {
  baseStatusFor,
  dateOnly,
  isLateCheckIn,
  monthBoundsOf,
  monthRange,
  todayDateOnly,
} from './attendance.util';

const ADMIN_ROLES = ['COMPANY_ADMIN', 'HR_MANAGER'];

@Injectable()
export class AttendanceService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly leave: LeaveService,
    private readonly documents: DocumentsService,
    private readonly notifications: NotificationDispatcher,
  ) {}

  /** Applicant email on any regularization decision (manual here; auto-resolve lives in the finalization processor). */
  private async notifyRegularizationDecided(
    req: { id: string; employeeId: string; targetDate: Date },
    outcome: 'APPROVED' | 'REJECTED',
    user: AuthenticatedUser,
    comment?: string,
  ) {
    await this.notifications.notify({
      tenantId: this.tenantPrisma.tenantId,
      template: 'REGULARIZATION_DECIDED',
      context: {
        requestId: req.id,
        targetDate: req.targetDate.toISOString().slice(0, 10),
        outcome,
        comment: comment ?? null,
      },
      dedupeKey: `regularization:${req.id}:decided`,
      to: { employeeIds: [req.employeeId] },
      actorUserId: user.sub,
    });
  }

  /** Folds each regularization's live evidence file (module 09) into the row. */
  private async withEvidence<T extends { id: string }>(rows: T[]) {
    const evidence = await this.documents.attachmentsFor(
      'REGULARIZATION',
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({ ...r, evidence: evidence.get(r.id) ?? null }));
  }

  private requireEmployee(user: AuthenticatedUser): string {
    if (!user.employeeId) {
      throw new BadRequestException('This account is not linked to an employee record');
    }
    return user.employeeId;
  }

  /** Every employee in `managerId`'s full reporting subtree, any depth —
   *  mirrors `LeaveService`'s identical helper (module 03's Line-Manager
   *  recursive-subtree decision). Direct Prisma access rather than
   *  importing EmployeesService, same circular-dependency reasoning. */
  private async recursiveReportIds(managerId: string): Promise<string[]> {
    const employees = await this.tenantPrisma.client.employee.findMany({
      select: { id: true, reportingManagerId: true },
    });
    return [...recursiveReportIdsPure(employees, managerId)];
  }

  private async assertCanDecideRegularization(employeeId: string, user: AuthenticatedUser) {
    if (ADMIN_ROLES.includes(user.role)) return;
    if (user.role === 'LINE_MANAGER' && user.employeeId) {
      const subordinates = await this.recursiveReportIds(user.employeeId);
      if (subordinates.includes(employeeId)) return;
    }
    throw new ForbiddenException('Not authorized to decide this regularization request');
  }

  private async writeAuditLog(
    user: AuthenticatedUser,
    action: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ) {
    await this.tenantPrisma.client.auditLog
      .create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
          actorUserId: user.sub,
          action,
          targetType: 'employee',
          targetId,
          metadata: { module: 'attendance', ...metadata },
        },
      })
      .catch(() => undefined);
  }

  /**
   * The tenant's per-tenant shift/grace config (docs/TENANT_CONFIGURATION.md
   * layer 2), not a hardcoded constant. `Employee.shiftId` is a per-employee
   * override (layer 3); falls back to the tenant's one `isDefault` shift,
   * seeded on every tenant at onboarding (`PlatformAdminService.seedTenantDefaults`).
   */
  private async resolveShift(employeeId: string, tenantId: string) {
    const employee = await this.tenantPrisma.client.employee.findUnique({
      where: { id: employeeId },
      include: { shift: true },
    });
    if (employee?.shift) return employee.shift;

    const defaultShift = await this.tenantPrisma.client.shift.findFirst({
      where: { tenantId, isDefault: true },
    });
    if (!defaultShift) {
      throw new BadRequestException(
        'No default shift configured for this tenant — contact your admin',
      );
    }
    return defaultShift;
  }

  // ---- Clock in/out ----

  async clockIn(user: AuthenticatedUser) {
    const employeeId = this.requireEmployee(user);
    const tenantId = this.tenantPrisma.tenantId;
    const date = todayDateOnly();

    const existing = await this.tenantPrisma.client.attendanceRecord.findUnique({
      where: { tenantId_employeeId_date: { tenantId, employeeId, date } },
    });
    if (existing?.checkInAt && !existing.checkOutAt) {
      throw new BadRequestException('Already clocked in today');
    }

    const now = new Date();
    const [holiday, settings, shift] = await Promise.all([
      this.tenantPrisma.client.holiday.findFirst({ where: { date } }),
      this.tenantPrisma.client.tenantSettings.findUniqueOrThrow({ where: { tenantId } }),
      this.resolveShift(employeeId, tenantId),
    ]);
    const isWeeklyOff = settings.weeklyOffDays.includes(date.getUTCDay());
    const status = holiday
      ? 'HOLIDAY'
      : isWeeklyOff
        ? 'WEEKLY_OFF'
        : isLateCheckIn(now, shift)
          ? 'LATE'
          : 'PRESENT';

    const record = await this.tenantPrisma.client.attendanceRecord.upsert({
      where: { tenantId_employeeId_date: { tenantId, employeeId, date } },
      create: { tenantId, employeeId, date, checkInAt: now, source: 'WEB', status },
      update: { checkInAt: now, checkOutAt: null, source: 'WEB', status },
    });

    // Source-of-truth capture row — the nightly finalization job (and any
    // future biometric/import source) reads `punches`, not this record's
    // checkInAt/checkOutAt directly. Best-effort: a punch write failing
    // must never block the clock-in itself.
    await this.tenantPrisma.client.punch
      .create({ data: { tenantId, employeeId, at: now, direction: 'IN', source: 'WEB' } })
      .catch(() => undefined);

    if (holiday || isWeeklyOff) {
      await this.leave.creditCompOff(employeeId, date, holiday?.name ?? 'weekly-off');
    }

    return record;
  }

  async clockOut(user: AuthenticatedUser) {
    const employeeId = this.requireEmployee(user);
    const tenantId = this.tenantPrisma.tenantId;
    const date = todayDateOnly();

    const record = await this.tenantPrisma.client.attendanceRecord.findUnique({
      where: { tenantId_employeeId_date: { tenantId, employeeId, date } },
    });
    if (!record?.checkInAt) {
      throw new BadRequestException('Not clocked in today');
    }
    if (record.checkOutAt) {
      throw new BadRequestException('Already clocked out today');
    }

    const openBreak = await this.tenantPrisma.client.attendanceBreak.findFirst({
      where: { attendanceRecordId: record.id, endAt: null },
    });
    if (openBreak) {
      throw new BadRequestException('End your current break before clocking out');
    }

    const now = new Date();
    const updated = await this.tenantPrisma.client.attendanceRecord.update({
      where: { id: record.id },
      data: { checkOutAt: now },
    });

    await this.tenantPrisma.client.punch
      .create({ data: { tenantId, employeeId, at: now, direction: 'OUT', source: 'WEB' } })
      .catch(() => undefined);

    return updated;
  }

  // ---- Breaks ----

  async startBreak(user: AuthenticatedUser) {
    const employeeId = this.requireEmployee(user);
    const record = await this.todaysRecord(employeeId);
    if (!record?.checkInAt || record.checkOutAt) {
      throw new BadRequestException('Clock in before starting a break');
    }
    const openBreak = await this.tenantPrisma.client.attendanceBreak.findFirst({
      where: { attendanceRecordId: record.id, endAt: null },
    });
    if (openBreak) {
      throw new BadRequestException('A break is already in progress');
    }
    return this.tenantPrisma.client.attendanceBreak.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        attendanceRecordId: record.id,
        startAt: new Date(),
      },
    });
  }

  async endBreak(user: AuthenticatedUser) {
    const employeeId = this.requireEmployee(user);
    const record = await this.todaysRecord(employeeId);
    const openBreak = record
      ? await this.tenantPrisma.client.attendanceBreak.findFirst({
          where: { attendanceRecordId: record.id, endAt: null },
        })
      : null;
    if (!openBreak) {
      throw new BadRequestException('No break in progress');
    }
    return this.tenantPrisma.client.attendanceBreak.update({
      where: { id: openBreak.id },
      data: { endAt: new Date() },
    });
  }

  private todaysRecord(employeeId: string) {
    return this.tenantPrisma.client.attendanceRecord.findUnique({
      where: {
        tenantId_employeeId_date: {
          tenantId: this.tenantPrisma.tenantId,
          employeeId,
          date: todayDateOnly(),
        },
      },
    });
  }

  // ---- Reads ----

  async today(user: AuthenticatedUser) {
    const employeeId = this.requireEmployee(user);
    const tenantId = this.tenantPrisma.tenantId;
    const [record, shift] = await Promise.all([
      this.tenantPrisma.client.attendanceRecord.findUnique({
        where: {
          tenantId_employeeId_date: { tenantId, employeeId, date: todayDateOnly() },
        },
        include: { breaks: { orderBy: { startAt: 'asc' } } },
      }),
      this.resolveShift(employeeId, tenantId),
    ]);
    const targetHours = Number(shift.minHoursFullDay);
    const targetMs = targetHours * 3600 * 1000;

    if (!record) {
      return { record: null, effectiveMs: 0, isOnBreak: false, targetHours, overtimeMs: 0 };
    }

    const breakMs = record.breaks.reduce((sum, b) => {
      const end = b.endAt ?? new Date();
      return sum + (end.getTime() - b.startAt.getTime());
    }, 0);
    const grossEnd = record.checkOutAt ?? new Date();
    const grossMs = record.checkInAt ? grossEnd.getTime() - record.checkInAt.getTime() : 0;
    const effectiveMs = Math.max(grossMs - breakMs, 0);
    const isOnBreak = record.breaks.some((b) => !b.endAt);
    const overtimeMs = Math.max(effectiveMs - targetMs, 0);

    return { record, effectiveMs, isOnBreak, targetHours, overtimeMs };
  }

  async calendar(user: AuthenticatedUser, month: string) {
    const employeeId = this.requireEmployee(user);
    const { start, end } = monthRange(month);
    return this.tenantPrisma.client.attendanceRecord.findMany({
      where: { employeeId, date: { gte: start, lt: end } },
      include: { breaks: true },
      orderBy: { date: 'asc' },
    });
  }

  async stats(user: AuthenticatedUser, month: string) {
    const employeeId = this.requireEmployee(user);
    const tenantId = this.tenantPrisma.tenantId;
    const { start, end } = monthRange(month);

    const [records, shift] = await Promise.all([
      this.tenantPrisma.client.attendanceRecord.findMany({
        where: { employeeId, date: { gte: start, lt: end } },
        include: { breaks: true },
      }),
      this.resolveShift(employeeId, tenantId),
    ]);

    const workingDays = records.filter(
      (r) => r.status !== 'WEEKLY_OFF' && r.status !== 'HOLIDAY' && r.status !== 'ON_LEAVE',
    ).length;
    const presentDays = records.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length;
    const lateDays = records.filter((r) => r.status === 'LATE').length;
    const punctualityRate =
      presentDays > 0 ? Math.round(((presentDays - lateDays) / presentDays) * 100) : 100;

    // Overtime — worked hours beyond the shift's minHoursFullDay, summed
    // over complete (checked-out) days in the month. This is HOURS only;
    // converting to statutory per-state overtime PAY is Payroll's job
    // (module 07, not built) — Attendance just measures the time.
    const targetMs = Number(shift.minHoursFullDay) * 3600 * 1000;
    let overtimeMs = 0;
    for (const r of records) {
      if (!r.checkInAt || !r.checkOutAt) continue;
      const breakMs = r.breaks.reduce((sum, b) => {
        const end = b.endAt ?? r.checkOutAt!;
        return sum + (end.getTime() - b.startAt.getTime());
      }, 0);
      const grossMs = r.checkOutAt.getTime() - r.checkInAt.getTime();
      const effectiveMs = Math.max(grossMs - breakMs, 0);
      overtimeMs += Math.max(effectiveMs - targetMs, 0);
    }

    const balances = user.employeeId ? await this.leave.getBalances(user.employeeId, user) : [];
    const remainingLeave = balances.reduce(
      (sum, b) => sum + (Number(b.accrued) - Number(b.used)),
      0,
    );

    return {
      daysPresent: presentDays,
      workingDays,
      punctualityRate,
      remainingLeave,
      overtimeHours: Math.round((overtimeMs / 3600000) * 10) / 10,
    };
  }

  /**
   * Month-end LOP (Loss of Pay) day count for Payroll (module 07, not built
   * yet) — the defined interface it should call once it exists. Counts
   * finalized `ABSENT` days only; Leave's own per-request `isLop` flag
   * (unpaid leave taken) is a separate, already-tracked figure — this is
   * Attendance's side: genuinely unexplained absence with no clock-in, no
   * approved leave, no punch, written by the nightly finalization job.
   */
  async getLopDays(employeeId: string, month: string): Promise<number> {
    const { start, end } = monthRange(month);
    return this.tenantPrisma.client.attendanceRecord.count({
      where: { employeeId, date: { gte: start, lt: end }, status: 'ABSENT' },
    });
  }

  // ---- Regularization ----

  async requestRegularization(dto: CreateRegularizationDto, user: AuthenticatedUser) {
    const employeeId = this.requireEmployee(user);
    const tenantId = this.tenantPrisma.tenantId;
    const targetDate = dateOnly(dto.targetDate);

    const attendanceSettings = await this.tenantPrisma.client.attendanceSettings.findUniqueOrThrow({
      where: { tenantId },
    });

    const daysSince = Math.round(
      (todayDateOnly().getTime() - targetDate.getTime()) / (24 * 3600 * 1000),
    );
    if (daysSince < 0) {
      throw new BadRequestException('Cannot request regularization for a future date');
    }
    if (daysSince > attendanceSettings.regularizationWindowDays) {
      throw new BadRequestException(
        `Regularization requests must be raised within ${attendanceSettings.regularizationWindowDays} day(s) of the date`,
      );
    }

    const { start: monthStart, end: monthEnd } = monthBoundsOf(targetDate);
    const countThisMonth = await this.tenantPrisma.client.regularizationRequest.count({
      where: {
        employeeId,
        targetDate: { gte: monthStart, lt: monthEnd },
        status: { in: ['PENDING', 'APPROVED'] },
      },
    });
    if (countThisMonth >= attendanceSettings.regularizationMonthlyCap) {
      throw new BadRequestException(
        `Monthly regularization cap (${attendanceSettings.regularizationMonthlyCap}) reached for this period`,
      );
    }

    const existingRecord = await this.tenantPrisma.client.attendanceRecord.findUnique({
      where: { tenantId_employeeId_date: { tenantId, employeeId, date: targetDate } },
    });

    const request = await this.tenantPrisma.client.regularizationRequest.create({
      data: {
        tenantId,
        employeeId,
        attendanceRecordId: existingRecord?.id,
        targetDate,
        reasonType: dto.reasonType,
        requestedCheckInAt: dto.requestedCheckInAt ? new Date(dto.requestedCheckInAt) : undefined,
        requestedCheckOutAt: dto.requestedCheckOutAt
          ? new Date(dto.requestedCheckOutAt)
          : undefined,
        note: dto.note,
      },
    });

    // The day is now under dispute — flag it rather than leave a stale
    // ABSENT/whatever status sitting there while a manager decides.
    if (existingRecord) {
      await this.tenantPrisma.client.attendanceRecord.update({
        where: { id: existingRecord.id },
        data: { status: 'PENDING_REGULARIZATION' },
      });
    }

    // The direct manager decides; with no manager it falls to HR (both can
    // act on it — `assertCanDecideRegularization`).
    const applicant = await this.tenantPrisma.client.employee.findUnique({
      where: { id: employeeId },
      select: { firstName: true, lastName: true, reportingManagerId: true },
    });
    if (applicant) {
      await this.notifications.notify({
        tenantId,
        template: 'REGULARIZATION_PENDING_APPROVAL',
        context: {
          requestId: request.id,
          applicantName: `${applicant.firstName} ${applicant.lastName}`,
          targetDate: request.targetDate.toISOString().slice(0, 10),
          reasonType: request.reasonType,
          note: request.note,
        },
        dedupeKey: `regularization:${request.id}:pending`,
        to: applicant.reportingManagerId
          ? { employeeIds: [applicant.reportingManagerId] }
          : { roles: HR_ROLES },
        actorUserId: user.sub,
      });
    }

    return request;
  }

  async listRegularizations(user: AuthenticatedUser) {
    const employeeId = this.requireEmployee(user);
    const rows = await this.tenantPrisma.client.regularizationRequest.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
    return this.withEvidence(rows);
  }

  /** One supporting file per *pending* request, applicant only (module 09 §8). */
  async attachEvidence(id: string, file: Express.Multer.File | undefined, user: AuthenticatedUser) {
    const req = await this.tenantPrisma.client.regularizationRequest.findUniqueOrThrow({
      where: { id },
    });
    if (req.employeeId !== user.employeeId) {
      throw new ForbiddenException('Only the requester can attach evidence to this request');
    }
    if (req.status !== 'PENDING') {
      throw new BadRequestException(`Request is not pending (status: ${req.status})`);
    }
    const evidence = await this.documents.upload(
      {
        employeeId: req.employeeId,
        ownerType: 'REGULARIZATION',
        ownerId: id,
        file,
        label: file?.originalname,
      },
      user,
    );
    return { ...req, evidence };
  }

  /** Pending regularization queue for a Line Manager (their recursive
   *  subtree) or HR/Admin (everyone) — mirrors `LeaveService.pendingApprovals`'
   *  scoping shape, minus the L1/L2 split Leave has (regularization is a
   *  single decision level). */
  async pendingRegularizations(user: AuthenticatedUser) {
    const scopeIds = ADMIN_ROLES.includes(user.role)
      ? null
      : user.employeeId
        ? await this.recursiveReportIds(user.employeeId)
        : [];
    if (scopeIds !== null && scopeIds.length === 0) return [];

    const rows = await this.tenantPrisma.client.regularizationRequest.findMany({
      where: {
        status: 'PENDING',
        ...(scopeIds === null ? {} : { employeeId: { in: scopeIds } }),
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, department: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return this.withEvidence(rows);
  }

  async cancelRegularization(id: string, user: AuthenticatedUser) {
    const req = await this.tenantPrisma.client.regularizationRequest.findUniqueOrThrow({
      where: { id },
    });
    if (req.employeeId !== user.employeeId) {
      throw new ForbiddenException('Only the requester can cancel this request');
    }
    if (req.status !== 'PENDING') {
      throw new BadRequestException(`Request is not pending (status: ${req.status})`);
    }
    return this.tenantPrisma.client.regularizationRequest.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  async approveRegularization(id: string, user: AuthenticatedUser, comment?: string) {
    const req = await this.tenantPrisma.client.regularizationRequest.findUniqueOrThrow({
      where: { id },
    });
    await this.assertCanDecideRegularization(req.employeeId, user);
    if (req.status !== 'PENDING') {
      throw new BadRequestException(`Request is not pending (status: ${req.status})`);
    }

    const tenantId = this.tenantPrisma.tenantId;
    const [existingRecord, shift] = await Promise.all([
      this.tenantPrisma.client.attendanceRecord.findUnique({
        where: {
          tenantId_employeeId_date: { tenantId, employeeId: req.employeeId, date: req.targetDate },
        },
      }),
      this.resolveShift(req.employeeId, tenantId),
    ]);

    const checkInAt = req.requestedCheckInAt ?? existingRecord?.checkInAt ?? null;
    const checkOutAt = req.requestedCheckOutAt ?? existingRecord?.checkOutAt ?? null;
    const status = checkInAt && isLateCheckIn(checkInAt, shift) ? 'LATE' : 'PRESENT';

    await this.tenantPrisma.client.attendanceRecord.upsert({
      where: {
        tenantId_employeeId_date: { tenantId, employeeId: req.employeeId, date: req.targetDate },
      },
      create: {
        tenantId,
        employeeId: req.employeeId,
        date: req.targetDate,
        checkInAt: checkInAt ?? undefined,
        checkOutAt: checkOutAt ?? undefined,
        status,
        source: 'MANUAL',
      },
      update: {
        checkInAt: checkInAt ?? undefined,
        checkOutAt: checkOutAt ?? undefined,
        status,
        source: 'MANUAL',
      },
    });

    const updated = await this.tenantPrisma.client.regularizationRequest.update({
      where: { id },
      data: { status: 'APPROVED', approverId: user.employeeId ?? undefined, decidedAt: new Date() },
    });

    await this.writeAuditLog(user, 'attendance.regularization_approved', req.employeeId, {
      requestId: id,
      comment,
    });
    await this.notifyRegularizationDecided(req, 'APPROVED', user, comment);

    return updated;
  }

  async rejectRegularization(id: string, user: AuthenticatedUser, comment?: string) {
    const req = await this.tenantPrisma.client.regularizationRequest.findUniqueOrThrow({
      where: { id },
    });
    await this.assertCanDecideRegularization(req.employeeId, user);
    if (req.status !== 'PENDING') {
      throw new BadRequestException(`Request is not pending (status: ${req.status})`);
    }

    // The day "stands as it was" — recompute its base status (holiday /
    // weekly-off / absent) rather than leaving it stuck at
    // PENDING_REGULARIZATION.
    if (req.attendanceRecordId) {
      const tenantId = this.tenantPrisma.tenantId;
      const [holiday, settings] = await Promise.all([
        this.tenantPrisma.client.holiday.findFirst({ where: { date: req.targetDate } }),
        this.tenantPrisma.client.tenantSettings.findUniqueOrThrow({ where: { tenantId } }),
      ]);
      await this.tenantPrisma.client.attendanceRecord.update({
        where: { id: req.attendanceRecordId },
        data: { status: baseStatusFor(req.targetDate, holiday, settings.weeklyOffDays) },
      });
    }

    const updated = await this.tenantPrisma.client.regularizationRequest.update({
      where: { id },
      data: { status: 'REJECTED', approverId: user.employeeId ?? undefined, decidedAt: new Date() },
    });

    await this.writeAuditLog(user, 'attendance.regularization_rejected', req.employeeId, {
      requestId: id,
      comment,
    });
    await this.notifyRegularizationDecided(req, 'REJECTED', user, comment);

    return updated;
  }

  async bulkApproveRegularizations(ids: string[], user: AuthenticatedUser) {
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      try {
        await this.approveRegularization(id, user);
        results.push({ id, ok: true });
      } catch (err) {
        results.push({ id, ok: false, error: err instanceof Error ? err.message : 'Failed' });
      }
    }
    return results;
  }

  // ---- Manager / HR views ----

  /** Team roster for one day — every report's attendance record (or `null`
   *  if they have none yet), scoped like `pendingRegularizations`. */
  async teamRoster(user: AuthenticatedUser, dateStr?: string) {
    const targetDate = dateStr ? dateOnly(dateStr) : todayDateOnly();
    const scopeIds = ADMIN_ROLES.includes(user.role)
      ? null
      : user.employeeId
        ? await this.recursiveReportIds(user.employeeId)
        : [];
    if (scopeIds !== null && scopeIds.length === 0) return [];

    const employees = await this.tenantPrisma.client.employee.findMany({
      where: scopeIds === null ? {} : { id: { in: scopeIds } },
      select: { id: true, firstName: true, lastName: true, department: { select: { name: true } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const employeeIds = employees.map((e) => e.id);

    const records = await this.tenantPrisma.client.attendanceRecord.findMany({
      where: { employeeId: { in: employeeIds }, date: targetDate },
    });
    const byEmployee = new Map(records.map((r) => [r.employeeId, r]));

    return employees.map((e) => ({
      employeeId: e.id,
      employeeName: `${e.firstName} ${e.lastName}`,
      department: e.department?.name ?? null,
      record: byEmployee.get(e.id) ?? null,
    }));
  }

  /** Manual attendance marking by HR/Admin (FR-ATT-001) — always reasoned
   *  and audited, for the one-off cases that self-service/regularization
   *  don't cover (e.g. backfilling a day for someone who never had system
   *  access that day). */
  async markAttendance(dto: MarkAttendanceDto, user: AuthenticatedUser) {
    const tenantId = this.tenantPrisma.tenantId;
    const date = dateOnly(dto.date);

    const record = await this.tenantPrisma.client.attendanceRecord.upsert({
      where: { tenantId_employeeId_date: { tenantId, employeeId: dto.employeeId, date } },
      create: {
        tenantId,
        employeeId: dto.employeeId,
        date,
        status: dto.status,
        checkInAt: dto.checkInAt ? new Date(dto.checkInAt) : undefined,
        checkOutAt: dto.checkOutAt ? new Date(dto.checkOutAt) : undefined,
        source: 'MANUAL',
      },
      update: {
        status: dto.status,
        checkInAt: dto.checkInAt ? new Date(dto.checkInAt) : undefined,
        checkOutAt: dto.checkOutAt ? new Date(dto.checkOutAt) : undefined,
        source: 'MANUAL',
      },
    });

    await this.writeAuditLog(user, 'attendance.manually_marked', dto.employeeId, {
      date: dto.date,
      status: dto.status,
      reason: dto.reason,
    });

    return record;
  }

  // ---- Tenant configuration: shifts + attendance/general settings ----
  // (docs/TENANT_CONFIGURATION.md layer 2 — "engine wiring" + Settings UI)

  listShifts() {
    return this.tenantPrisma.client.shift.findMany({ orderBy: { name: 'asc' } });
  }

  async createShift(dto: CreateShiftDto) {
    const tenantId = this.tenantPrisma.tenantId;
    if (dto.isDefault) {
      await this.tenantPrisma.client.shift.updateMany({
        where: { tenantId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return this.tenantPrisma.client.shift.create({ data: { tenantId, ...dto } });
  }

  async updateShift(id: string, dto: UpdateShiftDto) {
    const shift = await this.tenantPrisma.client.shift.findUnique({ where: { id } });
    if (!shift) throw new NotFoundException('Shift not found');

    if (dto.isDefault) {
      await this.tenantPrisma.client.shift.updateMany({
        where: { tenantId: this.tenantPrisma.tenantId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }
    return this.tenantPrisma.client.shift.update({ where: { id }, data: dto });
  }

  async deleteShift(id: string) {
    const shift = await this.tenantPrisma.client.shift.findUnique({ where: { id } });
    if (!shift) throw new NotFoundException('Shift not found');
    if (shift.isDefault) {
      throw new BadRequestException(
        'Cannot delete the default shift — set another shift as default first',
      );
    }
    await this.tenantPrisma.client.shift.delete({ where: { id } });
    return { deleted: true };
  }

  async getAttendanceConfig() {
    const tenantId = this.tenantPrisma.tenantId;
    const [attendanceSettings, tenantSettings] = await Promise.all([
      this.tenantPrisma.client.attendanceSettings.findUniqueOrThrow({ where: { tenantId } }),
      this.tenantPrisma.client.tenantSettings.findUniqueOrThrow({ where: { tenantId } }),
    ]);
    return {
      mode: attendanceSettings.mode,
      captureMethods: attendanceSettings.captureMethods,
      regularizationWindowDays: attendanceSettings.regularizationWindowDays,
      regularizationMonthlyCap: attendanceSettings.regularizationMonthlyCap,
      unactionedBehavior: attendanceSettings.unactionedBehavior,
      timezone: tenantSettings.timezone,
      weeklyOffDays: tenantSettings.weeklyOffDays,
      payrollCutoffDay: tenantSettings.payrollCutoffDay,
    };
  }

  async updateAttendanceConfig(dto: UpdateAttendanceSettingsDto) {
    const tenantId = this.tenantPrisma.tenantId;
    const { timezone, weeklyOffDays, payrollCutoffDay, ...attendanceFields } = dto;
    const tenantFieldsGiven =
      timezone !== undefined || weeklyOffDays !== undefined || payrollCutoffDay !== undefined;

    await Promise.all([
      Object.keys(attendanceFields).length > 0
        ? this.tenantPrisma.client.attendanceSettings.update({
            where: { tenantId },
            data: attendanceFields,
          })
        : Promise.resolve(),
      tenantFieldsGiven
        ? this.tenantPrisma.client.tenantSettings.update({
            where: { tenantId },
            data: { timezone, weeklyOffDays, payrollCutoffDay },
          })
        : Promise.resolve(),
    ]);
    return this.getAttendanceConfig();
  }
}
