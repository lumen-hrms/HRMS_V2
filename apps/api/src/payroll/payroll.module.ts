import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { LeaveModule } from '../leave/leave.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PayrollController } from './payroll.controller';
import { PayrollConfigService } from './payroll-config.service';
import { SalaryStructureService } from './salary-structure.service';
import { PayrollRunService } from './payroll-run.service';
import { TdsService } from './tds.service';
import { FullAndFinalService } from './full-and-final.service';
import { DECLARATION_PROVIDER, NullDeclarationProvider } from './declaration-provider';

@Module({
  imports: [AttendanceModule, LeaveModule, NotificationsModule],
  controllers: [PayrollController],
  providers: [
    PayrollConfigService,
    SalaryStructureService,
    PayrollRunService,
    TdsService,
    FullAndFinalService,
    { provide: DECLARATION_PROVIDER, useClass: NullDeclarationProvider },
  ],
  exports: [
    PayrollConfigService,
    SalaryStructureService,
    PayrollRunService,
    TdsService,
    FullAndFinalService,
  ],
})
export class PayrollModule {}
