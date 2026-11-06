import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { LeaveModule } from '../leave/leave.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { AdminInsightsService } from './admin-insights.service';
import { EmployeeInsightsService } from './employee-insights.service';

@Module({
  imports: [LeaveModule, AttendanceModule],
  controllers: [DashboardController],
  providers: [AdminInsightsService, EmployeeInsightsService],
})
export class DashboardModule {}
