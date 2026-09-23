import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { LeaveModule } from '../leave/leave.module';
import { AttendanceModule } from '../attendance/attendance.module';

@Module({
  imports: [LeaveModule, AttendanceModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
