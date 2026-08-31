import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { LeaveModule } from '../leave/leave.module';

@Module({
  imports: [LeaveModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
