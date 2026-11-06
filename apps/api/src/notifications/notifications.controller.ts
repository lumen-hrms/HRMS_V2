import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

/** Email log (module 10 §3.3). */
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get('log')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER', 'AUDITOR')
  list(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.service.list({ status, limit });
  }

  @Post('log/:id/retry')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  retry(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.retry(id, user);
  }
}
