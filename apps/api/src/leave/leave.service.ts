import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, LeaveLedgerSource } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { StorageService } from '../storage/storage.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import type {
  ApplyLeaveDto,
  BalanceAdjustmentDto,
  CreateHolidayDto,
  CreateLeaveTypeDto,
  DecideLeaveDto,
  UpdateHolidayDto,
  UpdateLeaveSettingsDto,
  UpdateLeaveTypeDto,
} from './dto/leave.dto';
import { LEAVE_QUEUE } from './leave.constants';
import { resolveLeaveYear } from './leave-year.util';

const ADMIN_ROLES = ['COMPANY_ADMIN', 'HR_MANAGER'];

const REQUEST_INCLUDE = {
  employee: { include: { department: true } },
  leaveType: true,
  approvals: { include: { approver: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.LeaveRequestInclude;

/** Working-day count: inclusive of start/end, excluding holidays and weekly-offs. */
function countWorkingDays(
  start: Date,
  end: Date,
  holidayDates: Set<string>,
  weeklyOffDays: number[],
): number {
  let count = 0;
  const cur = new Date(start);
  while (cur.getTime() <= end.getTime()) {
    const iso = cur.toISOString().slice(0, 10);
    if (!holidayDates.has(iso) && !weeklyOffDays.includes(cur.getUTCDay())) {
      count++;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

/** Prisma `Decimal` serializes to a string over JSON — every numeric field the
 *  frontend does arithmetic on must be coerced before it leaves the service. */
function num(value: Prisma.Decimal | number | null | undefined): number {
  return value == null ? 0 : Number(value);
}

@Injectable()
export class LeaveService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly storage: StorageService,
    @InjectQueue(LEAVE_QUEUE) private readonly leaveQueue: Queue,
  ) {}

  // ---- Tenant settings (leave-specific slice) ----

  private getTenantSettings() {
    return this.tenantPrisma.client.tenantSettings.findUniqueOrThrow({
      where: { tenantId: this.tenantPrisma.tenantId },
    });
  }

  getSettings() {
    return this.getTenantSettings();
  }

  async updateSettings(dto: UpdateLeaveSettingsDto) {
    return this.tenantPrisma.client.tenantSettings.update({
      where: { tenantId: this.tenantPrisma.tenantId },
      data: {
        ...(dto.leaveApprovalLevels !== undefined && {
          leaveApprovalLevels: dto.leaveApprovalLevels,
        }),
        ...(dto.leaveEscalationDays !== undefined && {
          leaveEscalationDays: dto.leaveEscalationDays,
        }),
        ...(dto.allowLopRequests !== undefined && { allowLopRequests: dto.allowLopRequests }),
        ...(dto.fyStartMonth !== undefined && { fyStartMonth: dto.fyStartMonth }),
      },
    });
  }

  // ---- Leave type configuration ----

  listTypes(includeInactive = false) {
    return this.tenantPrisma.client.leaveType.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: 'asc' },
    });
  }

  createType(dto: CreateLeaveTypeDto) {
    return this.tenantPrisma.client.leaveType.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        name: dto.name,
        code: dto.code,
        colorToken: dto.colorToken ?? '#2b5a8c',
        annualQuota: dto.annualQuota,
        carryForwardCap: dto.carryForwardCap ?? 0,
        minNoticeDays: dto.minNoticeDays ?? 0,
        active: dto.active ?? true,
        accrualFrequency: dto.accrualFrequency ?? 'ANNUAL',
        genderRestriction: dto.genderRestriction ?? 'ANY',
        paid: dto.paid ?? true,
        requiresApproval: dto.requiresApproval ?? true,
        isCompOff: dto.isCompOff ?? false,
      },
    });
  }

  updateType(id: string, dto: UpdateLeaveTypeDto) {
    return this.tenantPrisma.client.leaveType.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.colorToken !== undefined && { colorToken: dto.colorToken }),
        ...(dto.annualQuota !== undefined && { annualQuota: dto.annualQuota }),
        ...(dto.carryForwardCap !== undefined && { carryForwardCap: dto.carryForwardCap }),
        ...(dto.minNoticeDays !== undefined && { minNoticeDays: dto.minNoticeDays }),
        ...(dto.active !== undefined && { active: dto.active }),
        ...(dto.accrualFrequency !== undefined && { accrualFrequency: dto.accrualFrequency }),
        ...(dto.genderRestriction !== undefined && { genderRestriction: dto.genderRestriction }),
        ...(dto.paid !== undefined && { paid: dto.paid }),
        ...(dto.requiresApproval !== undefined && { requiresApproval: dto.requiresApproval }),
        ...(dto.isCompOff !== undefined && { isCompOff: dto.isCompOff }),
      },
    });
  }

  /** (Re)initializes this year's balance row for every employee for a leave type. */
  async initializeYearlyBalances(leaveTypeId: string, year: number) {
    const tenantId = this.tenantPrisma.tenantId;
    const [leaveType, employees] = await Promise.all([
      this.tenantPrisma.client.leaveType.findUniqueOrThrow({ where: { id: leaveTypeId } }),
      this.tenantPrisma.client.employee.findMany({ select: { id: true } }),
    ]);

    for (const emp of employees) {
      await this.tenantPrisma.client.leaveBalance.upsert({
        where: {
          tenantId_employeeId_leaveTypeId_year: {
            tenantId,
            employeeId: emp.id,
            leaveTypeId,
            year,
          },
        },
        create: {
          tenantId,
          employeeId: emp.id,
          leaveTypeId,
          year,
          accrued: leaveType.annualQuota,
          used: 0,
        },
        update: {},
      });
    }
    return { initialized: employees.length };
  }

  // ---- Holidays ----

  // Maps the `isOptional` column onto the frontend's `optional` field name
  // (apps/web/src/lib/leave/types.ts `Holiday`).
  private toHolidayDto(row: { id: string; date: Date; name: string; isOptional: boolean }) {
    return {
      id: row.id,
      date: row.date.toISOString().slice(0, 10),
      name: row.name,
      optional: row.isOptional,
    };
  }

  async listHolidays(year: number) {
    const rows = await this.tenantPrisma.client.holiday.findMany({
      where: {
        date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) },
      },
      orderBy: { date: 'asc' },
    });
    return rows.map((r) => this.toHolidayDto(r));
  }

  async createHoliday(dto: CreateHolidayDto) {
    const row = await this.tenantPrisma.client.holiday.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        date: new Date(dto.date),
        name: dto.name,
        isOptional: dto.optional ?? false,
      },
    });
    return this.toHolidayDto(row);
  }

  async updateHoliday(id: string, dto: UpdateHolidayDto) {
    const row = await this.tenantPrisma.client.holiday.update({
      where: { id },
      data: {
        ...(dto.date !== undefined && { date: new Date(dto.date) }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.optional !== undefined && { isOptional: dto.optional }),
      },
    });
    return this.toHolidayDto(row);
  }

  async deleteHoliday(id: string) {
    await this.tenantPrisma.client.holiday.delete({ where: { id } });
    return { deleted: true };
  }

  private async holidayDatesBetween(start: Date, end: Date): Promise<Set<string>> {
    const holidays = await this.tenantPrisma.client.holiday.findMany({
      where: { date: { gte: start, lte: end } },
      select: { date: true },
    });
    return new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
  }

  // ---- Response mappers (Decimal -> number, relations -> frontend contract) ----

  private toRequestDto(row: Prisma.LeaveRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>) {
    return {
      id: row.id,
      employeeId: row.employeeId,
      employee: {
        id: row.employee.id,
        firstName: row.employee.firstName,
        lastName: row.employee.lastName,
        department: row.employee.department?.name ?? null,
      },
      leaveType: {
        id: row.leaveType.id,
        name: row.leaveType.name,
        code: row.leaveType.code,
        colorToken: row.leaveType.colorToken,
      },
      status: row.status,
      startDate: row.startDate,
      endDate: row.endDate,
      days: num(row.days),
      halfDay: row.halfDay,
      reason: row.reason,
      isLop: row.isLop,
      attachmentName: row.attachmentName,
      createdAt: row.createdAt,
      approvals: row.approvals.map((a) => this.toApprovalStep(a)),
    };
  }

  private toApprovalStep(row: {
    level: number;
    approver: { firstName: string; lastName: string } | null;
    decision: string;
    decidedAt: Date;
    comment: string | null;
  }) {
    return {
      level: row.level,
      approverName: row.approver ? `${row.approver.firstName} ${row.approver.lastName}` : 'System',
      approverRole: row.level === 1 ? 'Line Manager' : 'HR Manager',
      decidedAt: row.decidedAt,
      decision: row.decision,
      comment: row.comment,
    };
  }

  private toBalanceDto(
    row: {
      leaveTypeId: string;
      leaveType: { id: string; name: string; code: string; colorToken: string };
      year: number;
      accrued: Prisma.Decimal;
      used: Prisma.Decimal;
    },
    pending: number,
    carriedForward: number,
  ) {
    return {
      leaveTypeId: row.leaveTypeId,
      leaveType: {
        id: row.leaveType.id,
        name: row.leaveType.name,
        code: row.leaveType.code,
        colorToken: row.leaveType.colorToken,
      },
      year: row.year,
      accrued: num(row.accrued),
      carriedForward,
      used: num(row.used),
      pending,
    };
  }

  private toLedgerDto(
    row: {
      id: string;
      employeeId: string;
      employee: { firstName: string; lastName: string };
      leaveType: { code: string };
      occurredAt: Date;
      delta: Prisma.Decimal;
      balanceAfter: Prisma.Decimal;
      source: LeaveLedgerSource;
      note: string | null;
    },
    actorName: string,
  ) {
    return {
      id: row.id,
      employeeId: row.employeeId,
      employeeName: `${row.employee.firstName} ${row.employee.lastName}`,
      leaveTypeCode: row.leaveType.code,
      at: row.occurredAt,
      delta: num(row.delta),
      balanceAfter: num(row.balanceAfter),
      source: row.source,
      note: row.note,
      actorName,
    };
  }

  /** Resolves User ids (ledger `actorUserId` / approval `approverId`-as-user, if ever needed)
   *  to display names via the linked Employee row — `User` itself has no name field. */
  private async resolveActorNames(
    userIds: (string | null | undefined)[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((x): x is string => !!x))];
    if (ids.length === 0) return new Map();
    const employees = await this.tenantPrisma.client.employee.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, firstName: true, lastName: true },
    });
    const map = new Map<string, string>();
    for (const e of employees) {
      if (e.userId) map.set(e.userId, `${e.firstName} ${e.lastName}`);
    }
    return map;
  }

  /** Sum of `days` across an employee's PENDING_L1/PENDING_L2 requests, grouped by leave type
   *  (unscoped by year, matching the balances this backs). */
  private async pendingDaysMap(employeeIds: string[]): Promise<Map<string, number>> {
    if (employeeIds.length === 0) return new Map();
    const rows = await this.tenantPrisma.client.leaveRequest.groupBy({
      by: ['employeeId', 'leaveTypeId'],
      where: { employeeId: { in: employeeIds }, status: { in: ['PENDING_L1', 'PENDING_L2'] } },
      _sum: { days: true },
    });
    const map = new Map<string, number>();
    for (const r of rows) map.set(`${r.employeeId}:${r.leaveTypeId}`, num(r._sum.days));
    return map;
  }

  /** Sum of CARRY_FORWARD ledger deltas per employee+type for a given year. */
  private async carriedForwardMap(
    employeeIds: string[],
    year: number,
  ): Promise<Map<string, number>> {
    if (employeeIds.length === 0) return new Map();
    const rows = await this.tenantPrisma.client.leaveLedgerEntry.groupBy({
      by: ['employeeId', 'leaveTypeId'],
      where: {
        employeeId: { in: employeeIds },
        source: 'CARRY_FORWARD',
        occurredAt: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      },
      _sum: { delta: true },
    });
    const map = new Map<string, number>();
    for (const r of rows) map.set(`${r.employeeId}:${r.leaveTypeId}`, num(r._sum.delta));
    return map;
  }

  // ---- Balances ----

  async getBalances(employeeId: string, user: AuthenticatedUser, year?: number) {
    await this.assertCanViewEmployee(employeeId, user);
    if (year === undefined) {
      const settings = await this.getTenantSettings();
      year = resolveLeaveYear(new Date(), settings.fyStartMonth);
    }
    const [balances, pendingMap, carryMap] = await Promise.all([
      this.tenantPrisma.client.leaveBalance.findMany({
        where: { employeeId, year },
        include: { leaveType: true },
      }),
      this.pendingDaysMap([employeeId]),
      this.carriedForwardMap([employeeId], year),
    ]);
    return balances.map((b) =>
      this.toBalanceDto(
        b,
        pendingMap.get(`${employeeId}:${b.leaveTypeId}`) ?? 0,
        carryMap.get(`${employeeId}:${b.leaveTypeId}`) ?? 0,
      ),
    );
  }

  /** Per-report balance matrix: Line Manager -> direct reports, HR/Admin -> everyone. */
  async teamBalances(user: AuthenticatedUser, year?: number) {
    if (year === undefined) {
      const settings = await this.getTenantSettings();
      year = resolveLeaveYear(new Date(), settings.fyStartMonth);
    }
    const employees = await this.tenantPrisma.client.employee.findMany({
      where: ADMIN_ROLES.includes(user.role)
        ? {}
        : { reportingManagerId: user.employeeId ?? '__none__' },
      include: {
        department: true,
        leaveBalances: { where: { year }, include: { leaveType: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const ids = employees.map((e) => e.id);
    const [pendingMap, carryMap] = await Promise.all([
      this.pendingDaysMap(ids),
      this.carriedForwardMap(ids, year),
    ]);
    return employees.map((e) => ({
      employeeId: e.id,
      employeeName: `${e.firstName} ${e.lastName}`,
      department: e.department?.name ?? null,
      balances: e.leaveBalances.map((b) =>
        this.toBalanceDto(
          b,
          pendingMap.get(`${e.id}:${b.leaveTypeId}`) ?? 0,
          carryMap.get(`${e.id}:${b.leaveTypeId}`) ?? 0,
        ),
      ),
    }));
  }

  async adjustBalanceManual(dto: BalanceAdjustmentDto, user: AuthenticatedUser) {
    const tenantId = this.tenantPrisma.tenantId;
    const balance = await this.tenantPrisma.client.leaveBalance.upsert({
      where: {
        tenantId_employeeId_leaveTypeId_year: {
          tenantId,
          employeeId: dto.employeeId,
          leaveTypeId: dto.leaveTypeId,
          year: dto.year,
        },
      },
      create: {
        tenantId,
        employeeId: dto.employeeId,
        leaveTypeId: dto.leaveTypeId,
        year: dto.year,
        accrued: Math.max(dto.delta, 0),
        used: 0,
      },
      update: { accrued: { increment: dto.delta } },
    });
    const balanceAfter = num(balance.accrued) - num(balance.used);
    const entry = await this.tenantPrisma.client.leaveLedgerEntry.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        leaveTypeId: dto.leaveTypeId,
        delta: dto.delta,
        balanceAfter,
        source: LeaveLedgerSource.HR_ADJUSTMENT,
        note: dto.note,
        actorUserId: user.sub,
      },
      include: { employee: true, leaveType: true },
    });
    const actorNames = await this.resolveActorNames([user.sub]);
    return this.toLedgerDto(entry, actorNames.get(user.sub) ?? 'System');
  }

  async ledger(employeeId?: string, leaveTypeCode?: string) {
    let leaveTypeId: string | undefined;
    if (leaveTypeCode) {
      const type = await this.tenantPrisma.client.leaveType.findFirst({
        where: { code: leaveTypeCode },
        select: { id: true },
      });
      leaveTypeId = type?.id ?? '__none__';
    }
    const rows = await this.tenantPrisma.client.leaveLedgerEntry.findMany({
      where: {
        ...(employeeId && { employeeId }),
        ...(leaveTypeId && { leaveTypeId }),
      },
      include: { employee: true, leaveType: true },
      orderBy: { occurredAt: 'desc' },
    });
    const actorNames = await this.resolveActorNames(rows.map((r) => r.actorUserId));
    return rows.map((r) =>
      this.toLedgerDto(r, r.actorUserId ? (actorNames.get(r.actorUserId) ?? 'System') : 'System'),
    );
  }

  // ---- Apply / cancel / approve / reject ----

  async apply(dto: ApplyLeaveDto, user: AuthenticatedUser) {
    if (!user.employeeId) {
      throw new BadRequestException('This account is not linked to an employee record');
    }
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end < start) throw new BadRequestException('endDate must be on/after startDate');
    if (dto.halfDay && start.getTime() !== end.getTime()) {
      throw new BadRequestException('halfDay is only valid for a single-day request');
    }
    const settings = await this.getTenantSettings();
    const year = resolveLeaveYear(start, settings.fyStartMonth);

    const [employee, balance, leaveType, holidayDates] = await Promise.all([
      this.tenantPrisma.client.employee.findUniqueOrThrow({ where: { id: user.employeeId } }),
      this.tenantPrisma.client.leaveBalance.findUnique({
        where: {
          tenantId_employeeId_leaveTypeId_year: {
            tenantId: this.tenantPrisma.tenantId,
            employeeId: user.employeeId,
            leaveTypeId: dto.leaveTypeId,
            year,
          },
        },
      }),
      this.tenantPrisma.client.leaveType.findUniqueOrThrow({ where: { id: dto.leaveTypeId } }),
      this.holidayDatesBetween(start, end),
    ]);

    if (leaveType.minNoticeDays > 0) {
      const noticeDays = (start.getTime() - Date.now()) / 86_400_000;
      if (noticeDays < leaveType.minNoticeDays) {
        throw new BadRequestException(
          `${leaveType.name} requires at least ${leaveType.minNoticeDays} days' notice.`,
        );
      }
    }

    // `Employee.gender` is free-text (no schema-level enum), so a data-quality
    // gap must never block a legitimate employee — only enforce when it
    // normalizes cleanly to MALE/FEMALE and actually mismatches.
    if (leaveType.genderRestriction !== 'ANY') {
      const empGender = employee.gender?.trim().toUpperCase();
      if (
        (empGender === 'MALE' || empGender === 'FEMALE') &&
        empGender !== leaveType.genderRestriction
      ) {
        throw new BadRequestException(
          `${leaveType.name} is restricted to ${leaveType.genderRestriction.toLowerCase()} employees.`,
        );
      }
    }

    const days = dto.halfDay
      ? 0.5
      : countWorkingDays(start, end, holidayDates, settings.weeklyOffDays);
    const available = balance ? num(balance.accrued) - num(balance.used) : 0;
    const isLop = days > available;

    if (isLop && !settings.allowLopRequests) {
      throw new BadRequestException(
        'This request would exceed your leave balance and Loss-of-Pay requests are disabled for your organization.',
      );
    }

    const status =
      settings.leaveApprovalLevels === 1
        ? 'PENDING_L2'
        : employee.reportingManagerId
          ? 'PENDING_L1'
          : 'PENDING_L2';

    const request = await this.tenantPrisma.client.leaveRequest.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        employeeId: user.employeeId,
        leaveTypeId: dto.leaveTypeId,
        startDate: start,
        endDate: end,
        days,
        halfDay: dto.halfDay ?? false,
        isLop,
        reason: dto.reason,
        status,
      },
      include: REQUEST_INCLUDE,
    });

    await this.scheduleEscalation(
      request.id,
      status === 'PENDING_L1' ? 1 : 2,
      settings.leaveEscalationDays,
    );
    return this.toRequestDto(request);
  }

  async attach(id: string, file: Express.Multer.File, user: AuthenticatedUser) {
    const req = await this.tenantPrisma.client.leaveRequest.findUniqueOrThrow({ where: { id } });
    if (req.employeeId !== user.employeeId && !ADMIN_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only the applicant or an HR admin can attach a document');
    }
    const key = this.storage.buildKey(
      this.tenantPrisma.tenantId,
      req.employeeId,
      file.originalname,
    );
    await this.storage.upload(key, file.buffer, file.mimetype);
    const updated = await this.tenantPrisma.client.leaveRequest.update({
      where: { id },
      data: {
        attachmentKey: key,
        attachmentName: file.originalname,
        attachmentMimeType: file.mimetype,
        attachmentSizeBytes: file.size,
      },
      include: REQUEST_INCLUDE,
    });
    return this.toRequestDto(updated);
  }

  async cancel(id: string, user: AuthenticatedUser) {
    const req = await this.tenantPrisma.client.leaveRequest.findUniqueOrThrow({ where: { id } });
    if (req.employeeId !== user.employeeId && !ADMIN_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only the applicant or an HR admin can cancel this request');
    }
    if (req.status === 'APPROVED') {
      const settings = await this.getTenantSettings();
      if (!req.isLop) {
        await this.adjustUsedDays(
          req.employeeId,
          req.leaveTypeId,
          resolveLeaveYear(req.startDate, settings.fyStartMonth),
          -Number(req.days),
          LeaveLedgerSource.REQUEST_CANCELLED,
          user.sub,
          `Leave request ${id} cancelled`,
        );
      }
      const holidayDates = await this.holidayDatesBetween(req.startDate, req.endDate);
      await this.syncAttendanceForLeave(
        req.employeeId,
        req.startDate,
        req.endDate,
        holidayDates,
        settings.weeklyOffDays,
        false,
      );
    }
    const updated = await this.tenantPrisma.client.leaveRequest.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: REQUEST_INCLUDE,
    });
    return this.toRequestDto(updated);
  }

  async approve(id: string, user: AuthenticatedUser, dto?: DecideLeaveDto) {
    const req = await this.tenantPrisma.client.leaveRequest.findUniqueOrThrow({
      where: { id },
      include: { employee: true },
    });

    if (req.status === 'PENDING_L1') {
      const isReportingManager = req.employee.reportingManagerId === user.employeeId;
      if (!isReportingManager && !ADMIN_ROLES.includes(user.role)) {
        throw new ForbiddenException('Only the reporting manager or HR admin can give L1 approval');
      }
      const [updated] = await Promise.all([
        this.tenantPrisma.client.leaveRequest.update({
          where: { id },
          data: {
            status: 'PENDING_L2',
            l1ApproverId: user.employeeId ?? undefined,
            l1DecidedAt: new Date(),
          },
          include: REQUEST_INCLUDE,
        }),
        this.recordApproval(id, 1, user.employeeId ?? null, 'APPROVED', dto?.comment ?? null),
      ]);
      const settings = await this.getTenantSettings();
      await this.scheduleEscalation(id, 2, settings.leaveEscalationDays);
      return this.toRequestDto(updated);
    }

    if (req.status === 'PENDING_L2') {
      if (!ADMIN_ROLES.includes(user.role)) {
        throw new ForbiddenException(
          'Only HR Manager or Company Admin can give final (L2) approval',
        );
      }
      const settings = await this.getTenantSettings();
      if (!req.isLop) {
        await this.adjustUsedDays(
          req.employeeId,
          req.leaveTypeId,
          resolveLeaveYear(req.startDate, settings.fyStartMonth),
          Number(req.days),
          LeaveLedgerSource.REQUEST_APPROVED,
          user.sub,
          `Leave request ${id} approved`,
        );
      }
      // Physically on leave regardless of LOP — LOP only affects pay/balance.
      const holidayDates = await this.holidayDatesBetween(req.startDate, req.endDate);
      await this.syncAttendanceForLeave(
        req.employeeId,
        req.startDate,
        req.endDate,
        holidayDates,
        settings.weeklyOffDays,
        true,
      );
      const [updated] = await Promise.all([
        this.tenantPrisma.client.leaveRequest.update({
          where: { id },
          data: {
            status: 'APPROVED',
            l2ApproverId: user.employeeId ?? undefined,
            l2DecidedAt: new Date(),
          },
          include: REQUEST_INCLUDE,
        }),
        this.recordApproval(id, 2, user.employeeId ?? null, 'APPROVED', dto?.comment ?? null),
      ]);
      return this.toRequestDto(updated);
    }

    throw new BadRequestException(`Request is not pending approval (status: ${req.status})`);
  }

  async reject(id: string, user: AuthenticatedUser, dto?: DecideLeaveDto) {
    const req = await this.tenantPrisma.client.leaveRequest.findUniqueOrThrow({
      where: { id },
      include: { employee: true },
    });
    const isReportingManager = req.employee.reportingManagerId === user.employeeId;
    if (!isReportingManager && !ADMIN_ROLES.includes(user.role)) {
      throw new ForbiddenException('Not authorized to reject this request');
    }
    const level = req.status === 'PENDING_L1' ? 1 : 2;
    const [updated] = await Promise.all([
      this.tenantPrisma.client.leaveRequest.update({
        where: { id },
        data: { status: 'REJECTED' },
        include: REQUEST_INCLUDE,
      }),
      this.recordApproval(id, level, user.employeeId ?? null, 'REJECTED', dto?.comment ?? null),
    ]);
    return this.toRequestDto(updated);
  }

  async listForEmployee(employeeId: string, user: AuthenticatedUser) {
    await this.assertCanViewEmployee(employeeId, user);
    const rows = await this.tenantPrisma.client.leaveRequest.findMany({
      where: { employeeId },
      include: REQUEST_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toRequestDto(r));
  }

  /** Filtered org-wide register — All Requests (HR/Admin) / Auditor read-only. */
  async listRequests(filter: {
    status?: string;
    leaveTypeId?: string;
    departmentId?: string;
    from?: string;
    to?: string;
  }) {
    const where: Prisma.LeaveRequestWhereInput = {
      ...(filter.status && filter.status !== 'ALL' && { status: filter.status as never }),
      ...(filter.leaveTypeId && { leaveTypeId: filter.leaveTypeId }),
      ...(filter.departmentId && { employee: { departmentId: filter.departmentId } }),
      ...(filter.from && { endDate: { gte: new Date(filter.from) } }),
      ...(filter.to && { startDate: { lte: new Date(filter.to) } }),
    };
    const rows = await this.tenantPrisma.client.leaveRequest.findMany({
      where,
      include: REQUEST_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toRequestDto(r));
  }

  async getRequest(id: string, user: AuthenticatedUser) {
    const req = await this.tenantPrisma.client.leaveRequest.findUniqueOrThrow({
      where: { id },
      include: REQUEST_INCLUDE,
    });
    await this.assertCanViewEmployee(req.employeeId, user);
    return this.toRequestDto(req);
  }

  /** Requests awaiting this user's decision (L1 for their direct reports, L2 for HR/Admin). */
  async pendingApprovals(user: AuthenticatedUser) {
    const where: Prisma.LeaveRequestWhereInput[] = [];
    if (user.employeeId) {
      where.push({ status: 'PENDING_L1', employee: { reportingManagerId: user.employeeId } });
    }
    if (ADMIN_ROLES.includes(user.role)) {
      where.push({ status: 'PENDING_L2' });
    }
    if (where.length === 0) return [];
    const rows = await this.tenantPrisma.client.leaveRequest.findMany({
      where: { OR: where },
      include: REQUEST_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toRequestDto(r));
  }

  /** Team calendar: approved/pending leave for a manager's direct reports (whole company for HR/Admin). */
  async teamCalendar(user: AuthenticatedUser, from: string, to: string) {
    const rows = await this.tenantPrisma.client.leaveRequest.findMany({
      where: {
        status: { in: ['PENDING_L1', 'PENDING_L2', 'APPROVED'] },
        startDate: { lte: new Date(to) },
        endDate: { gte: new Date(from) },
        ...(ADMIN_ROLES.includes(user.role)
          ? {}
          : { employee: { reportingManagerId: user.employeeId ?? '__none__' } }),
      },
      include: { employee: true, leaveType: true },
    });
    return rows.map((r) => ({
      requestId: r.id,
      employeeId: r.employeeId,
      employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
      leaveTypeCode: r.leaveType.code,
      colorToken: r.leaveType.colorToken,
      startDate: r.startDate,
      endDate: r.endDate,
      status: r.status,
    }));
  }

  private async assertCanViewEmployee(employeeId: string, user: AuthenticatedUser) {
    if (ADMIN_ROLES.includes(user.role) || user.role === 'AUDITOR') return;
    if (user.employeeId === employeeId) return;
    if (user.role === 'LINE_MANAGER') {
      const target = await this.tenantPrisma.client.employee.findUnique({
        where: { id: employeeId },
        select: { reportingManagerId: true },
      });
      if (target?.reportingManagerId === user.employeeId) return;
    }
    throw new ForbiddenException('Not authorized to view this employee’s leave data');
  }

  private recordApproval(
    leaveRequestId: string,
    level: number,
    approverId: string | null,
    decision: 'APPROVED' | 'REJECTED' | 'ESCALATED',
    comment: string | null,
  ) {
    return this.tenantPrisma.client.leaveApproval.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        leaveRequestId,
        level,
        approverId,
        decision,
        comment,
      },
    });
  }

  private async scheduleEscalation(leaveRequestId: string, level: 1 | 2, escalationDays: number) {
    await this.leaveQueue.add(
      'escalate',
      { tenantId: this.tenantPrisma.tenantId, leaveRequestId, level },
      { delay: escalationDays * 24 * 60 * 60 * 1000, jobId: `escalate:${leaveRequestId}:${level}` },
    );
  }

  /** Adjusts `used` days for a request approval/cancellation and logs the ledger movement. */
  private async adjustUsedDays(
    employeeId: string,
    leaveTypeId: string,
    year: number,
    deltaUsedDays: number,
    source: LeaveLedgerSource,
    actorUserId: string | null,
    note: string,
  ) {
    const tenantId = this.tenantPrisma.tenantId;
    const balance = await this.tenantPrisma.client.leaveBalance.upsert({
      where: { tenantId_employeeId_leaveTypeId_year: { tenantId, employeeId, leaveTypeId, year } },
      create: {
        tenantId,
        employeeId,
        leaveTypeId,
        year,
        accrued: 0,
        used: Math.max(deltaUsedDays, 0),
      },
      update: { used: { increment: deltaUsedDays } },
    });
    const balanceAfter = num(balance.accrued) - num(balance.used);
    await this.tenantPrisma.client.leaveLedgerEntry.create({
      data: {
        tenantId,
        employeeId,
        leaveTypeId,
        // Ledger delta is the change in *available* balance — the inverse of a `used` increment.
        delta: -deltaUsedDays,
        balanceAfter,
        source,
        note,
        actorUserId,
      },
    });
  }

  /** Reconciles attendance for an approved/cancelled leave request's working
   *  days. `markOnLeave: true` creates an `ON_LEAVE` row for each day that
   *  has none yet — a real clock-in that day is never overwritten.
   *  `markOnLeave: false` (cancellation) removes only the `ON_LEAVE` rows
   *  this same method wrote; nothing else in the codebase sets that status,
   *  so this is safe without tracking which leave request created which row.
   *  Direct Prisma access rather than importing AttendanceService, since
   *  AttendanceModule already depends on LeaveModule — importing it back
   *  here would be circular. */
  private async syncAttendanceForLeave(
    employeeId: string,
    start: Date,
    end: Date,
    holidayDates: Set<string>,
    weeklyOffDays: number[],
    markOnLeave: boolean,
  ): Promise<void> {
    const tenantId = this.tenantPrisma.tenantId;
    const cur = new Date(start);
    while (cur.getTime() <= end.getTime()) {
      const iso = cur.toISOString().slice(0, 10);
      if (!holidayDates.has(iso) && !weeklyOffDays.includes(cur.getUTCDay())) {
        const date = new Date(cur);
        if (markOnLeave) {
          await this.tenantPrisma.client.attendanceRecord.upsert({
            where: { tenantId_employeeId_date: { tenantId, employeeId, date } },
            create: { tenantId, employeeId, date, status: 'ON_LEAVE' },
            update: {},
          });
        } else {
          await this.tenantPrisma.client.attendanceRecord.deleteMany({
            where: { tenantId, employeeId, date, status: 'ON_LEAVE' },
          });
        }
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }

  /** Credits +1 day to the tenant's designated comp-off `LeaveType`
   *  (`isCompOff: true`) when an employee works a holiday/weekly-off day.
   *  No-ops if the tenant hasn't configured one (opt-in per tenant), and is
   *  idempotent per employee/day via a `COMP_OFF_CREDIT` ledger check.
   *  Called from AttendanceService.clockIn(). */
  async creditCompOff(employeeId: string, date: Date, reason: string): Promise<void> {
    const tenantId = this.tenantPrisma.tenantId;
    const compOffType = await this.tenantPrisma.client.leaveType.findFirst({
      where: { isCompOff: true },
    });
    if (!compOffType) return;

    const dayEnd = new Date(date.getTime() + 24 * 60 * 60 * 1000);
    const already = await this.tenantPrisma.client.leaveLedgerEntry.findFirst({
      where: {
        employeeId,
        leaveTypeId: compOffType.id,
        source: LeaveLedgerSource.COMP_OFF_CREDIT,
        occurredAt: { gte: date, lt: dayEnd },
      },
    });
    if (already) return;

    const settings = await this.getTenantSettings();
    const year = resolveLeaveYear(date, settings.fyStartMonth);

    const balance = await this.tenantPrisma.client.leaveBalance.upsert({
      where: {
        tenantId_employeeId_leaveTypeId_year: {
          tenantId,
          employeeId,
          leaveTypeId: compOffType.id,
          year,
        },
      },
      create: { tenantId, employeeId, leaveTypeId: compOffType.id, year, accrued: 1, used: 0 },
      update: { accrued: { increment: 1 } },
    });
    const balanceAfter = num(balance.accrued) - num(balance.used);
    await this.tenantPrisma.client.leaveLedgerEntry.create({
      data: {
        tenantId,
        employeeId,
        leaveTypeId: compOffType.id,
        delta: 1,
        balanceAfter,
        source: LeaveLedgerSource.COMP_OFF_CREDIT,
        note: `Comp-off credit for working on ${reason} (${date.toISOString().slice(0, 10)})`,
        actorUserId: null,
      },
    });
  }
}
