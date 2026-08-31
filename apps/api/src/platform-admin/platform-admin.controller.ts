import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PlatformJwtAuthGuard } from '../common/guards/platform-jwt-auth.guard';
import { PlatformAdminService } from './platform-admin.service';
import {
  CreateTenantDto,
  PlatformLoginDto,
  PlatformMfaVerifyDto,
  UpdateTenantStatusDto,
} from './dto/platform-admin.dto';

@Controller('platform-admin')
export class PlatformAdminController {
  constructor(private readonly service: PlatformAdminService) {}

  @Post('auth/login')
  login(@Body() dto: PlatformLoginDto) {
    return this.service.login(dto.email, dto.password);
  }

  @Post('auth/mfa/verify')
  verifyMfa(@Body() dto: PlatformMfaVerifyDto) {
    return this.service.verifyMfa(dto.mfaChallengeToken, dto.code);
  }

  @Post('auth/mfa/enroll/verify')
  completeEnrollment(@Body() dto: PlatformMfaVerifyDto) {
    return this.service.completeEnrollment(dto.mfaChallengeToken, dto.code);
  }

  @UseGuards(PlatformJwtAuthGuard)
  @Get('tenants')
  listTenants() {
    return this.service.listTenants();
  }

  @UseGuards(PlatformJwtAuthGuard)
  @Post('tenants')
  createTenant(@Body() dto: CreateTenantDto) {
    return this.service.createTenant(dto);
  }

  @UseGuards(PlatformJwtAuthGuard)
  @Patch('tenants/:id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateTenantStatusDto) {
    return this.service.updateTenantStatus(id, dto.status);
  }
}
