import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { UpdateWizardStateDto } from './dto/tenant-config.dto';

/**
 * Progress tracking for the first-run setup wizard
 * (docs/TENANT_CONFIGURATION.md "Onboarding flow" step 3) — the last piece
 * of module 13. The wizard itself just orchestrates existing endpoints
 * (Attendance's general settings + shifts, Leave's holidays + types) from
 * the frontend; this service only owns the skippable/resumable state.
 */
@Injectable()
export class TenantConfigService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async getWizardState() {
    const settings = await this.tenantPrisma.client.tenantSettings.findUniqueOrThrow({
      where: { tenantId: this.tenantPrisma.tenantId },
      select: { setupWizardStatus: true, setupWizardStep: true },
    });
    return { status: settings.setupWizardStatus, step: settings.setupWizardStep };
  }

  async updateWizardState(dto: UpdateWizardStateDto) {
    const settings = await this.tenantPrisma.client.tenantSettings.update({
      where: { tenantId: this.tenantPrisma.tenantId },
      data: { setupWizardStatus: dto.status, setupWizardStep: dto.step },
      select: { setupWizardStatus: true, setupWizardStep: true },
    });
    return { status: settings.setupWizardStatus, step: settings.setupWizardStep };
  }
}
