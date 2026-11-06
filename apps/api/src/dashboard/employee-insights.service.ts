import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import { todayDateOnly } from '../attendance/attendance.util';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import {
  buildMyTeam,
  computeCelebrations,
  shapeTeamOnLeave,
  type TeamMember,
} from './employee-insights.calc';

const DAY_MS = 86_400_000;
const TEAM_LEAVE_WINDOW_DAYS = 7;

/**
 * What the employee dashboard shows beyond the basics: this month's
 * attendance, upcoming holidays, the caller's team (manager, teammates,
 * reports) and who on it is away, and recent joiners / anniversaries.
 * Optional modules (attendance, leave) are only queried when the plan has them.
 */
@Injectable()
export class EmployeeInsightsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly attendance: AttendanceService,
  ) {}

  async build(user: AuthenticatedUser, opts: { attendance: boolean; leave: boolean }) {
    const client = this.tenantPrisma.client;
    const today = todayDateOnly();

    const [people, holidays, stats] = await Promise.all([
      client.employee.findMany({
        select: {
          id: true,
          firstName: true,
          lastName: true,
          designation: true,
          reportingManagerId: true,
          lifecycleState: true,
          dateOfJoining: true,
        },
      }),
      client.holiday.findMany({
        where: { date: { gte: today } },
        orderBy: { date: 'asc' },
        take: 5,
        select: { id: true, date: true, name: true, isOptional: true },
      }),
      user.employeeId && opts.attendance
        ? this.attendance.stats(user, today.toISOString().slice(0, 7))
        : null,
    ]);

    const team = user.employeeId ? buildMyTeam(people, user.employeeId) : null;
    const teamOnLeave =
      team && opts.leave && team.members.length > 0
        ? await this.teamOnLeave(team.members, today)
        : [];

    return {
      monthAttendance: stats && {
        daysPresent: stats.daysPresent,
        workingDays: stats.workingDays,
        punctualityRate: stats.punctualityRate,
        overtimeHours: stats.overtimeHours,
        targetHours: stats.targetHours,
        daily: stats.daily,
      },
      upcomingHolidays: holidays.map((h) => ({
        id: h.id,
        name: h.name,
        date: h.date.toISOString().slice(0, 10),
        isOptional: h.isOptional,
        daysUntil: Math.round((h.date.getTime() - today.getTime()) / DAY_MS),
      })),
      myTeam: team && {
        manager: team.manager,
        teammateCount: team.teammateCount,
        reportCount: team.reportCount,
      },
      teamOnLeave,
      celebrations: computeCelebrations(people, today),
    };
  }

  private async teamOnLeave(members: TeamMember[], today: Date) {
    const leaves = await this.tenantPrisma.client.leaveRequest.findMany({
      where: {
        employeeId: { in: members.map((m) => m.id) },
        status: 'APPROVED',
        startDate: { lte: new Date(today.getTime() + (TEAM_LEAVE_WINDOW_DAYS + 1) * DAY_MS - 1) },
        endDate: { gte: today },
      },
      select: { employeeId: true, startDate: true, endDate: true, halfDay: true },
      orderBy: { startDate: 'asc' },
    });
    return shapeTeamOnLeave(leaves, members, today);
  }
}
