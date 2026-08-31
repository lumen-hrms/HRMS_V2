import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { LeaveService } from '../leave/leave.service';

const ADMIN_ROLES = ['COMPANY_ADMIN', 'HR_MANAGER'];

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly leave: LeaveService,
  ) {}

  @Get()
  async home(@CurrentUser() user: AuthenticatedUser) {
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
    };
  }
}
