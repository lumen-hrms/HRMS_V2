import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantConfigService } from './tenant-config.service';
import { UpdateWizardStateDto } from './dto/tenant-config.dto';

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly service: TenantConfigService) {}

  @Get('wizard')
  getWizardState() {
    return this.service.getWizardState();
  }

  @Patch('wizard')
  @Roles('COMPANY_ADMIN')
  updateWizardState(@Body() dto: UpdateWizardStateDto) {
    return this.service.updateWizardState(dto);
  }
}
