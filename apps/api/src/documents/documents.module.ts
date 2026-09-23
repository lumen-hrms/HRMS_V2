import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentScanProcessor } from './document-scan.processor';
import { ClamAvScanner } from './clamav.scanner';
import { DOCUMENTS_QUEUE } from './documents.constants';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    NotificationsModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        connection: { url: config.get('redis', { infer: true }).url },
      }),
    }),
    BullModule.registerQueue({ name: DOCUMENTS_QUEUE }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentScanProcessor, ClamAvScanner],
  exports: [DocumentsService],
})
export class DocumentsModule {}
