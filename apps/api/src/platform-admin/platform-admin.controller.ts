import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PlatformJwtAuthGuard } from '../common/guards/platform-jwt-auth.guard';
import type { AuthenticatedPlatformAdmin } from './platform-admin.types';
import { PlatformAdminService } from './platform-admin.service';
import { PlansService } from './plans.service';
import {
  AdjustPricingDto,
  ChangeTenantPlanDto,
  CreateTenantDto,
  PlatformAuditQueryDto,
  PlatformSessionDto,
  RequestBreakGlassDto,
  UpdatePlanDto,
  UpdatePlatformSettingsDto,
  UpdateTenantStatusDto,
} from './dto/platform-admin.dto';

@Controller('platform-admin')
export class PlatformAdminController {
  constructor(
    private readonly service: PlatformAdminService,
    private readonly plans: PlansService,
  ) {}

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
  @Get('tenants/:id')
  getTenant(@Param('id') id: string) {
    return this.service.getTenant(id);
  }

  @UseGuards(PlatformJwtAuthGuard)
  @Post('tenants')
  createTenant(
    @Body() dto: CreateTenantDto,
    @Req() req: Request & { user?: AuthenticatedPlatformAdmin },
  ) {
    return this.service.createTenant(dto, req.user?.email);
  }

  @UseGuards(PlatformJwtAuthGuard)
  @Post('tenants/:id/resend-admin-reset')
  resendAdminReset(@Param('id') id: string) {
    return this.service.resendAdminReset(id);
  }

  @UseGuards(PlatformJwtAuthGuard)
  @Patch('tenants/:id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTenantStatusDto,
    @Req() req: Request & { user?: AuthenticatedPlatformAdmin },
  ) {
    return this.service.updateTenantStatus(id, dto.status, req.user?.email, dto.reason);
  }

  @UseGuards(PlatformJwtAuthGuard)
  @Patch('tenants/:id/plan')
  changePlan(
    @Param('id') id: string,
    @Body() dto: ChangeTenantPlanDto,
    @Req() req: Request & { user?: AuthenticatedPlatformAdmin },
  ) {
    return this.service.changeTenantPlan(id, dto, req.user?.email);
  }

  @UseGuards(PlatformJwtAuthGuard)
  @Post('tenants/:id/renew')
  renew(@Param('id') id: string, @Req() req: Request & { user?: AuthenticatedPlatformAdmin }) {
    return this.service.renewSubscription(id, req.user?.email);
  }

  @UseGuards(PlatformJwtAuthGuard)
  @Patch('tenants/:id/pricing')
  adjustPricing(
    @Param('id') id: string,
    @Body() dto: AdjustPricingDto,
    @Req() req: Request & { user?: AuthenticatedPlatformAdmin },
  ) {
    return this.service.adjustPricing(id, dto, req.user?.email);
  }

  @UseGuards(PlatformJwtAuthGuard)
  @Post('tenants/:id/refresh-headcount')
  refreshHeadcount(
    @Param('id') id: string,
    @Req() req: Request & { user?: AuthenticatedPlatformAdmin },
  ) {
    return this.service.refreshHeadcountRoute(id, req.user?.email);
  }

  @UseGuards(PlatformJwtAuthGuard)
  @Post('tenants/:id/breakglass')
  requestBreakGlass(
    @Param('id') id: string,
    @Body() dto: RequestBreakGlassDto,
    @Req() req: Request & { user?: AuthenticatedPlatformAdmin },
  ) {
    return this.service.requestBreakGlass(id, dto, req.user?.email);
  }

  @UseGuards(PlatformJwtAuthGuard)
  @Get('tenants/:id/breakglass')
  getActiveBreakGlass(@Param('id') id: string) {
    return this.service.getActiveBreakGlass(id);
  }

  @UseGuards(PlatformJwtAuthGuard)
  @Post('tenants/:id/breakglass/:grantId/revoke')
  revokeBreakGlass(
    @Param('id') id: string,
    @Param('grantId') grantId: string,
    @Req() req: Request & { user?: AuthenticatedPlatformAdmin },
  ) {
    return this.service.revokeBreakGlass(id, grantId, req.user?.email);
  }

  @UseGuards(PlatformJwtAuthGuard)
  @Get('audit')
  audit(@Query() query: PlatformAuditQueryDto) {
    return this.service.audit(query);
  }

  // ---- Plan catalog ----

  @UseGuards(PlatformJwtAuthGuard)
  @Get('plans')
  listPlans() {
    return this.plans.listWithCounts();
  }

  @UseGuards(PlatformJwtAuthGuard)
  @Patch('plans/:key')
  updatePlan(
    @Param('key') key: string,
    @Body() dto: UpdatePlanDto,
    @Req() req: Request & { user?: AuthenticatedPlatformAdmin },
  ) {
    return this.plans.update(key, dto, req.user?.email);
  }

  // ---- Platform settings + leads (contact form) ----

  @UseGuards(PlatformJwtAuthGuard)
  @Get('settings')
  getSettings() {
    return this.service.getSettings();
  }

  @UseGuards(PlatformJwtAuthGuard)
  @Patch('settings')
  updateSettings(
    @Body() dto: UpdatePlatformSettingsDto,
    @Req() req: Request & { user?: AuthenticatedPlatformAdmin },
  ) {
    return this.service.updateSettings(dto.contactNotifyEmails, req.user?.email);
  }

  @UseGuards(PlatformJwtAuthGuard)
  @Get('leads')
  listLeads() {
    return this.service.listLeads();
  }
}
