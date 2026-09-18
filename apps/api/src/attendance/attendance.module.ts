import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { LeaveModule } from '../leave/leave.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceFinalizationProcessor } from './attendance-finalization.processor';
import { ATTENDANCE_QUEUE } from './attendance.constants';

@Module({
  imports: [
    LeaveModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        connection: { url: config.get('redis', { infer: true }).url },
      }),
    }),
    BullModule.registerQueue({ name: ATTENDANCE_QUEUE }),
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceFinalizationProcessor],
  exports: [AttendanceService],
})
export class AttendanceModule {}
