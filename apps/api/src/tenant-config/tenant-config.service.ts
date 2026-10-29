import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { UpdateCompanyProfileDto } from './dto/tenant-config.dto';
import { companyProfileErrors, normalizeCompanyProfile } from './company-profile';

/**
 * Tenant-level identity config (module 13): the company profile captured by
 * company setup (apps/api/src/setup), editable here afterwards. HR rules
 * (work week, shifts, leave policy) keep their own module endpoints.
 */
@Injectable()
export class TenantConfigService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async getCompanyProfile() {
    const [profile, settings] = await Promise.all([
      this.tenantPrisma.client.companyProfile.findUnique({
        where: { tenantId: this.tenantPrisma.tenantId },
      }),
      this.tenantPrisma.client.tenantSettings.findUnique({
        where: { tenantId: this.tenantPrisma.tenantId },
        select: { goLiveDate: true },
      }),
    ]);
    return {
      profile,
      goLiveDate: settings?.goLiveDate?.toISOString().slice(0, 10) ?? null,
    };
  }

  async updateCompanyProfile(dto: UpdateCompanyProfileDto) {
    const errors = companyProfileErrors(dto);
    if (Object.keys(errors).length > 0) {
      throw new BadRequestException(Object.values(errors));
    }
    const tenantId = this.tenantPrisma.tenantId;
    const data = normalizeCompanyProfile(dto);
    return this.tenantPrisma.client.companyProfile.upsert({
      where: { tenantId },
      update: data,
      create: { tenantId, ...data },
    });
  }
}
