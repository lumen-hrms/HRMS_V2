import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';
import { LeaveEscalationProcessor } from './leave-escalation.processor';
import { LeaveAccrualProcessor } from './leave-accrual.processor';
import { LEAVE_QUEUE } from './leave.constants';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        connection: { url: config.get('redis', { infer: true }).url },
      }),
    }),
    BullModule.registerQueue({ name: LEAVE_QUEUE }),
  ],
  controllers: [LeaveController],
  providers: [LeaveService, LeaveEscalationProcessor, LeaveAccrualProcessor],
  exports: [LeaveService],
})
export class LeaveModule {}
