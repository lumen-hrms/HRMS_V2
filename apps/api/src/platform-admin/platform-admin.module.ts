import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';
import { PlansService } from './plans.service';
import { PlatformScheduledJobsProcessor } from './platform-scheduled-jobs.processor';
import { PLATFORM_ADMIN_QUEUE } from './platform-admin.constants';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        connection: { url: config.get('redis', { infer: true }).url },
      }),
    }),
    BullModule.registerQueue({ name: PLATFORM_ADMIN_QUEUE }),
  ],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService, PlansService, PlatformScheduledJobsProcessor],
})
export class PlatformAdminModule {}
