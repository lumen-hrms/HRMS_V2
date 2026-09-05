import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PlatformJwtAuthGuard } from '../common/guards/platform-jwt-auth.guard';
import { PlatformAdminService } from './platform-admin.service';
import {
  CreateTenantDto,
  PlatformSessionDto,
  UpdateTenantStatusDto,
} from './dto/platform-admin.dto';

@Controller('platform-admin')
export class PlatformAdminController {
  constructor(private readonly service: PlatformAdminService) {}

  @Post('auth/session')
  async session(@Body() dto: PlatformSessionDto) {
    // Shape mirrors the tenant AuthController.session response the web app
    // expects: { status: 'ok', ... }.
    const admin = await this.service.session(dto.idToken);
    return { status: 'ok', admin };
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
