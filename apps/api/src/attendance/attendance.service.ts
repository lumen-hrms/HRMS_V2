import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { LeaveService } from '../leave/leave.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import type { CreateRegularizationDto } from './dto/attendance.dto';

/**
 * Shift policy is hardcoded for now — there's no per-tenant shift/grace
 * config yet (that's future work, flagged in the Attendance design brief
 * as a settings screen not built in this pass). 09:00 start, 15min grace
 * before a check-in counts as LATE, 8h target for the progress ring.
 */
const SHIFT_START_HOUR = 9;
const SHIFT_START_MINUTE = 0;
const GRACE_MINUTES = 15;
const TARGET_HOURS = 8;

/** Midnight UTC for "today" — a deliberate simplification for MVP scope
 * (matches the DATE column, no per-tenant timezone config yet). Swap for
 * a tenant-timezone-aware calendar day once that data exists. */
function todayDateOnly(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function dateOnly(iso: string): Date {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start, end };
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly leave: LeaveService,
  ) {}

  private requireEmployee(user: AuthenticatedUser): string {
    if (!user.employeeId) {
      throw new BadRequestException('This account is not linked to an employee record');
    }
    return user.employeeId;
  }

  private isLate(checkInAt: Date): boolean {
    const graceEnd = new Date(checkInAt);
    graceEnd.setUTCHours(SHIFT_START_HOUR, SHIFT_START_MINUTE + GRACE_MINUTES, 0, 0);
    return checkInAt > graceEnd;
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
    const [holiday, settings] = await Promise.all([
      this.tenantPrisma.client.holiday.findFirst({ where: { date } }),
      this.tenantPrisma.client.tenantSettings.findUniqueOrThrow({ where: { tenantId } }),
    ]);
    const isWeeklyOff = settings.weeklyOffDays.includes(date.getUTCDay());
    const status = holiday ? 'HOLIDAY' : isWeeklyOff ? 'WEEKLY_OFF' : this.isLate(now) ? 'LATE' : 'PRESENT';

    const record = await this.tenantPrisma.client.attendanceRecord.upsert({
      where: { tenantId_employeeId_date: { tenantId, employeeId, date } },
      create: { tenantId, employeeId, date, checkInAt: now, source: 'WEB', status },
      update: { checkInAt: now, checkOutAt: null, source: 'WEB', status },
    });

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

    return this.tenantPrisma.client.attendanceRecord.update({
      where: { id: record.id },
      data: { checkOutAt: new Date() },
    });
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
    const record = await this.tenantPrisma.client.attendanceRecord.findUnique({
      where: {
        tenantId_employeeId_date: {
          tenantId: this.tenantPrisma.tenantId,
          employeeId,
          date: todayDateOnly(),
        },
      },
      include: { breaks: { orderBy: { startAt: 'asc' } } },
    });

    if (!record) {
      return { record: null, effectiveMs: 0, isOnBreak: false, targetHours: TARGET_HOURS };
    }

    const breakMs = record.breaks.reduce((sum, b) => {
      const end = b.endAt ?? new Date();
      return sum + (end.getTime() - b.startAt.getTime());
    }, 0);
    const grossEnd = record.checkOutAt ?? new Date();
    const grossMs = record.checkInAt ? grossEnd.getTime() - record.checkInAt.getTime() : 0;
    const effectiveMs = Math.max(grossMs - breakMs, 0);
    const isOnBreak = record.breaks.some((b) => !b.endAt);

    return { record, effectiveMs, isOnBreak, targetHours: TARGET_HOURS };
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
    const { start, end } = monthRange(month);

    const records = await this.tenantPrisma.client.attendanceRecord.findMany({
      where: { employeeId, date: { gte: start, lt: end } },
    });

    const workingDays = records.filter(
      (r) => r.status !== 'WEEKLY_OFF' && r.status !== 'HOLIDAY' && r.status !== 'ON_LEAVE',
    ).length;
    const presentDays = records.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length;
    const lateDays = records.filter((r) => r.status === 'LATE').length;
    const punctualityRate =
      presentDays > 0 ? Math.round(((presentDays - lateDays) / presentDays) * 100) : 100;

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
    };
  }

  // ---- Regularization ----

  async requestRegularization(dto: CreateRegularizationDto, user: AuthenticatedUser) {
    const employeeId = this.requireEmployee(user);
    const tenantId = this.tenantPrisma.tenantId;
    const targetDate = dateOnly(dto.targetDate);

    const existingRecord = await this.tenantPrisma.client.attendanceRecord.findUnique({
      where: { tenantId_employeeId_date: { tenantId, employeeId, date: targetDate } },
    });

    return this.tenantPrisma.client.regularizationRequest.create({
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
  }

  async listRegularizations(user: AuthenticatedUser) {
    const employeeId = this.requireEmployee(user);
    return this.tenantPrisma.client.regularizationRequest.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
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
}
