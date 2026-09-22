import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { LeaveService } from '../leave/leave.service';
import { AttendanceService } from '../attendance/attendance.service';
import { PlatformPrismaClientProvider } from '../prisma/platform-prisma-client.provider';

const ADMIN_ROLES = ['COMPANY_ADMIN', 'HR_MANAGER'];

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly leave: LeaveService,
    private readonly attendance: AttendanceService,
    private readonly platformPrisma: PlatformPrismaClientProvider,
  ) {}

  @Get()
  async home(@CurrentUser() user: AuthenticatedUser) {
    // Own-attendance snapshot for everyone with a linked employee record
    // (including admins) — only when the tenant's plan includes ATTENDANCE
    // (dashboard has no route-level @RequiresModule since its content
    // varies by what's entitled, so this mirrors EntitlementGuard inline).
    const todayAttendance =
      user.employeeId && (await this.hasAttendanceEntitlement(user.tenantId))
        ? await this.todayAttendanceSnapshot(user)
        : null;

    if (ADMIN_ROLES.includes(user.role)) {
      const [headcount, byDepartment, pendingApprovals] = await Promise.all([
        this.tenantPrisma.client.employee.count(),
        this.tenantPrisma.client.department.findMany({
          select: { name: true, _count: { select: { employees: true } } },
        }),
        this.leave.pendingApprovals(user),
      ]);
      return {
        view: 'admin',
        headcount,
        departmentBreakdown: byDepartment.map((d) => ({ name: d.name, count: d._count.employees })),
        pendingApprovalsCount: pendingApprovals.length,
        todayAttendance,
      };
    }

    const [balances, pending, myRequests] = await Promise.all([
      user.employeeId ? this.leave.getBalances(user.employeeId, user) : [],
      this.leave.pendingApprovals(user),
      user.employeeId ? this.leave.listForEmployee(user.employeeId, user) : [],
    ]);

    return {
      view: 'employee',
      leaveBalances: balances,
      pendingApprovals: pending, // non-empty for Line Managers with reports
      myRecentRequests: myRequests.slice(0, 5),
      todayAttendance,
    };
  }

  private async hasAttendanceEntitlement(tenantId: string): Promise<boolean> {
    const subscription = await this.platformPrisma.subscription.findUnique({ where: { tenantId } });
    return subscription?.enabledModules.includes('ATTENDANCE') ?? false;
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
