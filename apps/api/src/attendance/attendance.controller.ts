import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { EntitlementGuard } from '../common/guards/entitlement.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresModule } from '../common/decorators/requires-module.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AttendanceService } from './attendance.service';
import {
  CreateRegularizationDto,
  CreateShiftDto,
  UpdateAttendanceSettingsDto,
  UpdateShiftDto,
} from './dto/attendance.dto';

@UseGuards(JwtAuthGuard, TenantGuard, EntitlementGuard, RolesGuard)
@RequiresModule('ATTENDANCE')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  @Post('clock-in')
  clockIn(@CurrentUser() user: AuthenticatedUser) {
    return this.service.clockIn(user);
  }

  @Post('clock-out')
  clockOut(@CurrentUser() user: AuthenticatedUser) {
    return this.service.clockOut(user);
  }

  @Post('break/start')
  startBreak(@CurrentUser() user: AuthenticatedUser) {
    return this.service.startBreak(user);
  }

  @Post('break/end')
  endBreak(@CurrentUser() user: AuthenticatedUser) {
    return this.service.endBreak(user);
  }

  @Get('today')
  today(@CurrentUser() user: AuthenticatedUser) {
    return this.service.today(user);
  }

  @Get('calendar')
  calendar(@Query('month') month: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.calendar(user, month);
  }

  @Get('stats')
  stats(@Query('month') month: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.stats(user, month);
  }

  @Post('regularization')
  requestRegularization(
    @Body() dto: CreateRegularizationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.requestRegularization(dto, user);
  }

  @Get('regularization')
  listRegularizations(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listRegularizations(user);
  }

  @Post('regularization/:id/cancel')
  cancelRegularization(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.cancelRegularization(id, user);
  }

  // ---- Tenant configuration: shifts + settings ----

  @Get('shifts')
  listShifts() {
    return this.service.listShifts();
  }

  @Post('shifts')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  createShift(@Body() dto: CreateShiftDto) {
    return this.service.createShift(dto);
  }

  @Patch('shifts/:id')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  updateShift(@Param('id') id: string, @Body() dto: UpdateShiftDto) {
    return this.service.updateShift(id, dto);
  }

  @Delete('shifts/:id')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  deleteShift(@Param('id') id: string) {
    return this.service.deleteShift(id);
  }

  @Get('settings')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER', 'AUDITOR')
  getSettings() {
    return this.service.getAttendanceConfig();
  }

  @Patch('settings')
  @Roles('COMPANY_ADMIN')
  updateSettings(@Body() dto: UpdateAttendanceSettingsDto) {
    return this.service.updateAttendanceConfig(dto);
  }
}
