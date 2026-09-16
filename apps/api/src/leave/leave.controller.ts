import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { LeaveService } from './leave.service';
import {
  ApplyLeaveDto,
  BalanceAdjustmentDto,
  CreateHolidayDto,
  CreateLeaveTypeDto,
  DecideLeaveDto,
  UpdateHolidayDto,
  UpdateLeaveSettingsDto,
  UpdateLeaveTypeDto,
} from './dto/leave.dto';

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('leave')
export class LeaveController {
  constructor(private readonly service: LeaveService) {}

  @Get('types')
  listTypes(@Query('includeInactive') includeInactive?: string) {
    return this.service.listTypes(includeInactive === 'true');
  }

  @Post('types')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  createType(@Body() dto: CreateLeaveTypeDto) {
    return this.service.createType(dto);
  }

  @Patch('types/:id')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  updateType(@Param('id') id: string, @Body() dto: UpdateLeaveTypeDto) {
    return this.service.updateType(id, dto);
  }

  @Post('types/:id/initialize/:year')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  initialize(@Param('id') id: string, @Param('year') year: string) {
    return this.service.initializeYearlyBalances(id, parseInt(year, 10));
  }

  @Get('holidays')
  listHolidays(@Query('year') year: string) {
    return this.service.listHolidays(parseInt(year, 10) || new Date().getFullYear());
  }

  @Post('holidays')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  createHoliday(@Body() dto: CreateHolidayDto) {
    return this.service.createHoliday(dto);
  }

  @Patch('holidays/:id')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  updateHoliday(@Param('id') id: string, @Body() dto: UpdateHolidayDto) {
    return this.service.updateHoliday(id, dto);
  }

  @Delete('holidays/:id')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  deleteHoliday(@Param('id') id: string) {
    return this.service.deleteHoliday(id);
  }

  @Get('settings')
  getSettings() {
    return this.service.getSettings();
  }

  @Patch('settings')
  @Roles('COMPANY_ADMIN')
  updateSettings(@Body() dto: UpdateLeaveSettingsDto) {
    return this.service.updateSettings(dto);
  }

  // Static `balances/...` routes must be declared before the dynamic
  // `balances/:employeeId` below — Nest matches routes in declaration
  // order, so a later static route would otherwise never be reached
  // (e.g. `balances/ledger` would match `:employeeId = "ledger"`).
  @Get('team/balances')
  teamBalances(@Query('year') year: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.teamBalances(user, parseInt(year, 10) || undefined);
  }

  @Post('balances/adjust')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  adjustBalance(@Body() dto: BalanceAdjustmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.adjustBalanceManual(dto, user);
  }

  @Get('balances/ledger')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER', 'AUDITOR')
  ledger(@Query('employeeId') employeeId?: string, @Query('leaveTypeCode') leaveTypeCode?: string) {
    return this.service.ledger(employeeId, leaveTypeCode);
  }

  @Get('balances/:employeeId')
  balances(
    @Param('employeeId') employeeId: string,
    @Query('year') year: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getBalances(employeeId, user, parseInt(year, 10) || undefined);
  }

  @Post('requests')
  apply(@Body() dto: ApplyLeaveDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.apply(dto, user);
  }

  @Get('requests')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER', 'AUDITOR')
  listRequests(
    @Query('status') status?: string,
    @Query('leaveTypeId') leaveTypeId?: string,
    @Query('department') departmentId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.listRequests({ status, leaveTypeId, departmentId, from, to });
  }

  @Get('requests/employee/:employeeId')
  listForEmployee(@Param('employeeId') employeeId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.listForEmployee(employeeId, user);
  }

  @Get('requests/pending-approvals')
  pending(@CurrentUser() user: AuthenticatedUser) {
    return this.service.pendingApprovals(user);
  }

  @Get('requests/:id')
  getRequest(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.getRequest(id, user);
  }

  @Post('requests/:id/attachment')
  @UseInterceptors(FileInterceptor('file'))
  attach(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.attach(id, file, user);
  }

  @Post('requests/:id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.cancel(id, user);
  }

  @Post('requests/:id/approve')
  @Roles('LINE_MANAGER', 'HR_MANAGER', 'COMPANY_ADMIN')
  approve(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto?: DecideLeaveDto,
  ) {
    return this.service.approve(id, user, dto);
  }

  @Post('requests/:id/reject')
  @Roles('LINE_MANAGER', 'HR_MANAGER', 'COMPANY_ADMIN')
  reject(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto?: DecideLeaveDto,
  ) {
    return this.service.reject(id, user, dto);
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
