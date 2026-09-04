import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AttendanceService } from './attendance.service';
import { CreateRegularizationDto } from './dto/attendance.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
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
}
