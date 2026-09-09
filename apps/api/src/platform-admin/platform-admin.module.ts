import { Module } from '@nestjs/common';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';
import { PlansService } from './plans.service';

@Module({
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService, PlansService],
})
export class PlatformAdminModule {}
