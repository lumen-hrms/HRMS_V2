import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import type { TenantResolvedRequest } from '../common/tenancy/tenant-resolution.middleware';
import { AccessService } from './access.service';
import { AuditQueryDto, ChangeRoleDto, SetUserStatusDto } from './dto/access.dto';

/**
 * Identity & Access management surface (module 01 §4.4). Nav-gated on the
 * frontend to Company Admin / HR Manager / Auditor; every mutating route is
 * additionally `@Roles`-gated here and the service enforces the row-level
 * invariants (privilege ceiling, keep ≥ 1 active Company Admin, no
 * self-deactivation).
 */
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('access')
export class AccessController {
  constructor(private readonly service: AccessService) {}

  /** The signed-in user's own identity card (My Account). Any tenant role. */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser, @Req() req: TenantResolvedRequest) {
    return this.service.getMe(user.sub, req.tenantName ?? req.tenantSubdomain ?? '');
  }

  @Get('users')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER', 'AUDITOR')
  listUsers() {
    return this.service.listUsers();
  }

  @Get('users/:id/activity')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER', 'AUDITOR')
  activity(@Param('id') id: string) {
    return this.service.recentActivity(id);
  }

  @Get('audit')
  @Roles('COMPANY_ADMIN', 'AUDITOR')
  audit(@Query() query: AuditQueryDto) {
    return query.feed === 'access'
      ? this.service.accessAudit(query)
      : this.service.loginAudit(query);
  }

  @Patch('users/:id/role')
  @Roles('COMPANY_ADMIN')
  changeRole(
    @Param('id') id: string,
    @Body() dto: ChangeRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.changeRole(user, id, dto);
  }

  @Patch('users/:id/status')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  setStatus(
    @Param('id') id: string,
    @Body() dto: SetUserStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setStatus(user, id, dto);
  }

  @Post('users/:id/password-reset')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  sendPasswordReset(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.sendPasswordReset(user, id);
  }
}
