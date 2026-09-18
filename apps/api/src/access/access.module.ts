import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { LoginAuditRetentionProcessor } from './login-audit-retention.processor';
import { ACCESS_QUEUE } from './access.constants';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        connection: { url: config.get('redis', { infer: true }).url },
      }),
    }),
    BullModule.registerQueue({ name: ACCESS_QUEUE }),
  ],
  controllers: [AccessController],
  providers: [AccessService, LoginAuditRetentionProcessor],
})
export class AccessModule {}
