import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { AuditService } from './audit.service';
import { AuditQueryDto, normalizeAuditFilter } from './dto/audit-query.dto';

/**
 * Module 12 — the cross-module "all activity" aggregation view. Complements
 * (does not replace) the narrower feed-specific reads that already exist
 * (`GET /api/access/audit?feed=login|access`, Platform Admin's
 * `GET /api/platform-admin/audit`) — this one spans every module that
 * writes `public.audit_log` in one query.
 */
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles('COMPANY_ADMIN', 'AUDITOR')
  list(@Query() query: AuditQueryDto) {
    return this.audit.query(normalizeAuditFilter(query));
  }

  @Get('modules')
  @Roles('COMPANY_ADMIN', 'AUDITOR')
  modules() {
    return this.audit.modules();
  }
}
