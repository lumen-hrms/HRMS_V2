import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { LeaveService } from './leave.service';
import { ApplyLeaveDto, CreateLeaveTypeDto } from './dto/leave.dto';

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('leave')
export class LeaveController {
  constructor(private readonly service: LeaveService) {}

  @Get('types')
  listTypes() {
    return this.service.listTypes();
  }

  @Post('types')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  createType(@Body() dto: CreateLeaveTypeDto) {
    return this.service.createType(dto);
  }

  @Post('types/:id/initialize/:year')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  initialize(@Param('id') id: string, @Param('year') year: string) {
    return this.service.initializeYearlyBalances(id, parseInt(year, 10));
  }

  @Get('balances/:employeeId')
  balances(@Param('employeeId') employeeId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.getBalances(employeeId, user);
  }

  @Post('requests')
  apply(@Body() dto: ApplyLeaveDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.apply(dto, user);
  }

  @Post('requests/:id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.cancel(id, user);
  }

  @Post('requests/:id/approve')
  @Roles('LINE_MANAGER', 'HR_MANAGER', 'COMPANY_ADMIN')
  approve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.approve(id, user);
  }

  @Post('requests/:id/reject')
  @Roles('LINE_MANAGER', 'HR_MANAGER', 'COMPANY_ADMIN')
  reject(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.reject(id, user);
  }

  @Get('requests/employee/:employeeId')
  listForEmployee(@Param('employeeId') employeeId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.listForEmployee(employeeId, user);
  }

  @Get('requests/pending-approvals')
  pending(@CurrentUser() user: AuthenticatedUser) {
    return this.service.pendingApprovals(user);
  }

  @Get('calendar')
  calendar(
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.teamCalendar(user, from, to);
  }
}
