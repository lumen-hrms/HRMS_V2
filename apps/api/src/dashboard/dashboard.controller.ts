import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { LeaveService } from '../leave/leave.service';
import { AttendanceService } from '../attendance/attendance.service';
import { PlatformPrismaClientProvider } from '../prisma/platform-prisma-client.provider';
import { AdminInsightsService } from './admin-insights.service';

const ADMIN_ROLES = ['COMPANY_ADMIN', 'HR_MANAGER'];

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly leave: LeaveService,
    private readonly attendance: AttendanceService,
    private readonly platformPrisma: PlatformPrismaClientProvider,
    private readonly insights: AdminInsightsService,
  ) {}

  @Get()
  async home(@CurrentUser() user: AuthenticatedUser) {
    // Own-attendance snapshot for everyone with a linked employee record
    // (including admins) — only when the tenant's plan includes ATTENDANCE
    // (dashboard has no route-level @RequiresModule since its content
    // varies by what's entitled, so this mirrors EntitlementGuard inline).
    const modules = await this.enabledModules(user.tenantId);
    const hasAttendance = modules.includes('ATTENDANCE');
    // Started now and awaited with each branch's other reads, so nothing waits on it.
    const todayAttendance =
      user.employeeId && hasAttendance ? this.todayAttendanceSnapshot(user) : Promise.resolve(null);

    if (ADMIN_ROLES.includes(user.role)) {
      const pendingApprovals = this.leave.pendingApprovals(user);
      const [headcount, byDepartment, pending, today, insights] = await Promise.all([
        this.tenantPrisma.client.employee.count(),
        this.tenantPrisma.client.department.findMany({
          select: { name: true, _count: { select: { employees: true } } },
        }),
        pendingApprovals,
        todayAttendance,
        this.insights.build({
          pendingApprovals,
          attendance: hasAttendance,
          payroll: modules.includes('PAYROLL'),
        }),
      ]);
      return {
        view: 'admin',
        headcount,
        departmentBreakdown: byDepartment.map((d) => ({ name: d.name, count: d._count.employees })),
        pendingApprovalsCount: pending.length,
        todayAttendance: today,
        insights,
      };
    }

    const [balances, pending, myRequests, today] = await Promise.all([
      user.employeeId ? this.leave.getBalances(user.employeeId, user) : [],
      this.leave.pendingApprovals(user),
      user.employeeId ? this.leave.listForEmployee(user.employeeId, user) : [],
      todayAttendance,
    ]);

    return {
      view: 'employee',
      leaveBalances: balances,
      pendingApprovals: pending, // non-empty for Line Managers with reports
      myRecentRequests: myRequests.slice(0, 5),
      todayAttendance: today,
    };
  }

  private async enabledModules(tenantId: string): Promise<string[]> {
    const subscription = await this.platformPrisma.subscription.findUnique({ where: { tenantId } });
    return subscription?.enabledModules ?? [];
  }

  private async todayAttendanceSnapshot(user: AuthenticatedUser) {
    const { record, isOnBreak, effectiveMs, targetHours } = await this.attendance.today(user);
    return {
      status: record?.status ?? null,
      checkInAt: record?.checkInAt ?? null,
      checkOutAt: record?.checkOutAt ?? null,
      isOnBreak,
      effectiveMs,
      targetHours,
    };
  }
}
