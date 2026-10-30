import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { todayDateOnly } from '../attendance/attendance.util';
import { computeWorkforceInsights } from './admin-insights.calc';

const DAY_MS = 86_400_000;

/**
 * Everything the Company Admin / HR dashboard shows beyond the basics: who is
 * working, who is away today, what needs a decision, and what's coming up.
 * Optional modules (attendance, payroll) are only queried when the tenant's
 * plan includes them.
 */
@Injectable()
export class AdminInsightsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async build(opts: {
    /** Requests already waiting on this user (LeaveService.pendingApprovals) — may still be loading. */
    pendingApprovals: any[] | Promise<any[]>;
    attendance: boolean;
    payroll: boolean;
  }) {
    const client = this.tenantPrisma.client;
    const today = todayDateOnly();
    const endOfToday = new Date(today.getTime() + DAY_MS - 1);

    const [employees, onLeave, attendanceRows, pendingRegularizations, holidays, payrollRun] =
      await Promise.all([
        client.employee.findMany({
          select: {
            id: true,
            firstName: true,
            lastName: true,
            designation: true,
            departmentId: true,
            department: { select: { name: true } },
            dateOfBirth: true,
            dateOfJoining: true,
            lifecycleState: true,
            lastWorkingDate: true,
          },
        }),
        client.leaveRequest.findMany({
          where: { status: 'APPROVED', startDate: { lte: endOfToday }, endDate: { gte: today } },
          select: {
            id: true,
            endDate: true,
            halfDay: true,
            employee: { select: { id: true, firstName: true, lastName: true } },
            leaveType: { select: { name: true } },
          },
          orderBy: { endDate: 'asc' },
        }),
        opts.attendance
          ? client.attendanceRecord.groupBy({
              by: ['status'],
              where: { date: today },
              _count: { _all: true },
            })
          : Promise.resolve(null),
        opts.attendance
          ? client.regularizationRequest.count({ where: { status: 'PENDING' } })
          : Promise.resolve(null),
        client.holiday.findMany({
          where: { date: { gte: today } },
          orderBy: { date: 'asc' },
          take: 4,
        }),
        opts.payroll
          ? client.payrollRun.findFirst({
              orderBy: { period: 'desc' },
              select: { period: true, status: true },
            })
          : Promise.resolve(null),
      ]);

    const workforce = computeWorkforceInsights(employees, today);

    const perStatus = new Map(
      (attendanceRows ?? []).map((r) => [r.status as string, r._count._all]),
    );
    const late = perStatus.get('LATE') ?? 0;

    return {
      asOf: today.toISOString().slice(0, 10),
      ...workforce,
      onLeaveToday: {
        total: onLeave.length,
        people: onLeave.slice(0, 6).map((r) => ({
          id: r.employee.id,
          name: `${r.employee.firstName} ${r.employee.lastName}`.trim(),
          leaveType: r.leaveType.name,
          halfDay: r.halfDay,
          until: r.endDate.toISOString().slice(0, 10),
        })),
      },
      attendanceToday: attendanceRows
        ? {
            present: (perStatus.get('PRESENT') ?? 0) + late,
            late,
            onLeave: perStatus.get('ON_LEAVE') ?? 0,
            absent: perStatus.get('ABSENT') ?? 0,
          }
        : null,
      pendingRegularizations,
      pendingApprovals: (await opts.pendingApprovals).slice(0, 5).map((r) => ({
        id: r.id,
        employee: { firstName: r.employee?.firstName ?? '', lastName: r.employee?.lastName ?? '' },
        leaveType: { name: r.leaveType?.name ?? '' },
        days: r.days,
        startDate: r.startDate,
        endDate: r.endDate,
      })),
      upcomingHolidays: holidays.map((h) => ({
        date: h.date.toISOString().slice(0, 10),
        name: h.name,
        isOptional: h.isOptional,
      })),
      latestPayroll: payrollRun,
    };
  }
}
