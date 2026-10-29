import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantConfigService } from './tenant-config.service';
import { UpdateCompanyProfileDto } from './dto/tenant-config.dto';

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly service: TenantConfigService) {}

  @Get('company-profile')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER', 'AUDITOR')
  getCompanyProfile() {
    return this.service.getCompanyProfile();
  }

  @Patch('company-profile')
  @Roles('COMPANY_ADMIN')
  updateCompanyProfile(@Body() dto: UpdateCompanyProfileDto) {
    return this.service.updateCompanyProfile(dto);
  }
}
