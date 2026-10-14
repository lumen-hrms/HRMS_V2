import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { WorkspaceStatusService } from './workspace-status.service';
import { PasswordResetLimiter, PasswordResetService } from './password-reset.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [AuthController],
  providers: [AuthService, WorkspaceStatusService, PasswordResetService, PasswordResetLimiter],
  exports: [AuthService],
})
export class AuthModule {}
