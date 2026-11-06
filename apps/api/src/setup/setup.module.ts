import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { LeaveEntitlementModule } from '../leave/leave-entitlement.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';

@Module({
  imports: [EmployeesModule, LeaveEntitlementModule, NotificationsModule],
  controllers: [SetupController],
  providers: [SetupService],
})
export class SetupModule {}
