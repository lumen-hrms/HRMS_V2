import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ContactController } from './contact.controller';
import { ContactService, ContactLimiter } from './contact.service';

@Module({
  imports: [NotificationsModule],
  controllers: [ContactController],
  providers: [ContactService, ContactLimiter],
})
export class ContactModule {}
