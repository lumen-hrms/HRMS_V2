import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { NotificationDispatcher, NOTIFICATIONS_QUEUE } from './notification-dispatcher.service';
import { NotificationSendProcessor } from './notification-send.processor';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { SesEmailSender } from './ses-email.sender';
import { AuthEmailService } from './auth-email.service';
import {
  EmailSuppressionOperatorController,
  SesEventsWebhookController,
} from './email-suppression.controller';
import { EmailSuppressionService } from './email-suppression.service';
import { SnsMessageVerifier } from './sns-message-verifier';

/**
 * Module 10. Feature modules import this for `NotificationDispatcher`;
 * it imports none of them back (no circular dependency).
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        connection: { url: config.get('redis', { infer: true }).url },
      }),
    }),
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  controllers: [
    NotificationsController,
    SesEventsWebhookController,
    EmailSuppressionOperatorController,
  ],
  providers: [
    NotificationDispatcher,
    NotificationSendProcessor,
    NotificationsService,
    SesEmailSender,
    AuthEmailService,
    EmailSuppressionService,
    SnsMessageVerifier,
  ],
  exports: [NotificationDispatcher, AuthEmailService, SesEmailSender],
})
export class NotificationsModule {}
