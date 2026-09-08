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

const ADMIN_ROLES = ['COMPANY_ADMIN', 'HR_MANAGER'];

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
      },
    });
  }

  // ---- Leave type configuration ----

  listTypes() {
    return this.tenantPrisma.client.leaveType.findMany({ orderBy: { name: 'asc' } });
  }

  createType(dto: CreateLeaveTypeDto) {
    return this.tenantPrisma.client.leaveType.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        name: dto.name,
        annualQuota: dto.annualQuota,
        carryForwardCap: dto.carryForwardCap ?? 0,
        accrualFrequency: dto.accrualFrequency ?? 'ANNUAL',
      },
    });
  }

  updateType(id: string, dto: UpdateLeaveTypeDto) {
    return this.tenantPrisma.client.leaveType.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.annualQuota !== undefined && { annualQuota: dto.annualQuota }),
        ...(dto.carryForwardCap !== undefined && { carryForwardCap: dto.carryForwardCap }),
        ...(dto.accrualFrequency !== undefined && { accrualFrequency: dto.accrualFrequency }),
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

  // ---- Balances ----

  async getBalances(employeeId: string, user: AuthenticatedUser) {
    await this.assertCanViewEmployee(employeeId, user);
    return this.tenantPrisma.client.leaveBalance.findMany({
      where: { employeeId },
      include: { leaveType: true },
      orderBy: { year: 'desc' },
    });
  }

  /** Per-report balance matrix: Line Manager -> direct reports, HR/Admin -> everyone. */
  async teamBalances(user: AuthenticatedUser, year: number) {
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
    return employees.map((e) => ({
      employeeId: e.id,
      employeeName: `${e.firstName} ${e.lastName}`,
      department: e.department?.name ?? null,
      balances: e.leaveBalances,
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
    const balanceAfter = Number(balance.accrued) - Number(balance.used);
    return this.tenantPrisma.client.leaveLedgerEntry.create({
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
    });
  }

  ledger(employeeId?: string, leaveTypeId?: string) {
    return this.tenantPrisma.client.leaveLedgerEntry.findMany({
      where: {
        ...(employeeId && { employeeId }),
        ...(leaveTypeId && { leaveTypeId }),
      },
      include: { employee: true, leaveType: true },
      orderBy: { occurredAt: 'desc' },
    });
  }

  // ---- Apply / cancel / approve / reject ----

  async apply(dto: ApplyLeaveDto, user: AuthenticatedUser) {
    if (!user.employeeId) {
      throw new BadRequestException('This account is not linked to an employee record');
    }
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end < start) throw new BadRequestException('endDate must be on/after startDate');
    const year = start.getFullYear();

    const [employee, balance, settings, holidayDates] = await Promise.all([
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
      this.getTenantSettings(),
      this.holidayDatesBetween(start, end),
    ]);

    const days = countWorkingDays(start, end, holidayDates, settings.weeklyOffDays);
    const available = balance ? Number(balance.accrued) - Number(balance.used) : 0;
    const isLop = days > available;

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
        isLop,
        reason: dto.reason,
        status,
      },
    });

    await this.scheduleEscalation(
      request.id,
      status === 'PENDING_L1' ? 1 : 2,
      settings.leaveEscalationDays,
    );
    return request;
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
    return this.tenantPrisma.client.leaveRequest.update({
      where: { id },
      data: {
        attachmentKey: key,
        attachmentName: file.originalname,
        attachmentMimeType: file.mimetype,
        attachmentSizeBytes: file.size,
      },
    });
  }

  async cancel(id: string, user: AuthenticatedUser) {
    const req = await this.tenantPrisma.client.leaveRequest.findUniqueOrThrow({ where: { id } });
    if (req.employeeId !== user.employeeId && !ADMIN_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only the applicant or an HR admin can cancel this request');
    }
    if (req.status === 'APPROVED' && !req.isLop) {
      await this.adjustUsedDays(
        req.employeeId,
        req.leaveTypeId,
        req.startDate.getFullYear(),
        -Number(req.days),
        LeaveLedgerSource.REQUEST_CANCELLED,
        user.sub,
        `Leave request ${id} cancelled`,
      );
    }
    return this.tenantPrisma.client.leaveRequest.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
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
        }),
        this.recordApproval(id, 1, user.employeeId ?? null, 'APPROVED', dto?.comment ?? null),
      ]);
      const settings = await this.getTenantSettings();
      await this.scheduleEscalation(id, 2, settings.leaveEscalationDays);
      return updated;
    }

    if (req.status === 'PENDING_L2') {
      if (!ADMIN_ROLES.includes(user.role)) {
        throw new ForbiddenException(
          'Only HR Manager or Company Admin can give final (L2) approval',
        );
      }
      if (!req.isLop) {
        await this.adjustUsedDays(
          req.employeeId,
          req.leaveTypeId,
          req.startDate.getFullYear(),
          Number(req.days),
          LeaveLedgerSource.REQUEST_APPROVED,
          user.sub,
          `Leave request ${id} approved`,
        );
      }
      const [updated] = await Promise.all([
        this.tenantPrisma.client.leaveRequest.update({
          where: { id },
          data: {
            status: 'APPROVED',
            l2ApproverId: user.employeeId ?? undefined,
            l2DecidedAt: new Date(),
          },
        }),
        this.recordApproval(id, 2, user.employeeId ?? null, 'APPROVED', dto?.comment ?? null),
      ]);
      return updated;
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
      }),
      this.recordApproval(id, level, user.employeeId ?? null, 'REJECTED', dto?.comment ?? null),
    ]);
    return updated;
  }

  async listForEmployee(employeeId: string, user: AuthenticatedUser) {
    await this.assertCanViewEmployee(employeeId, user);
    return this.tenantPrisma.client.leaveRequest.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Filtered org-wide register — All Requests (HR/Admin) / Auditor read-only. */
  listRequests(filter: {
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
    return this.tenantPrisma.client.leaveRequest.findMany({
      where,
      include: { employee: { include: { department: true } }, leaveType: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getRequest(id: string, user: AuthenticatedUser) {
    const req = await this.tenantPrisma.client.leaveRequest.findUniqueOrThrow({
      where: { id },
      include: {
        employee: { include: { department: true } },
        leaveType: true,
        approvals: { include: { approver: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    await this.assertCanViewEmployee(req.employeeId, user);
    return req;
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
    return this.tenantPrisma.client.leaveRequest.findMany({
      where: { OR: where },
      include: { employee: true, leaveType: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Team calendar: approved/pending leave for a manager's direct reports (whole company for HR/Admin). */
  async teamCalendar(user: AuthenticatedUser, from: string, to: string) {
    return this.tenantPrisma.client.leaveRequest.findMany({
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
    const balanceAfter = Number(balance.accrued) - Number(balance.used);
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
}
