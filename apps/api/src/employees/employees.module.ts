import { Module } from '@nestjs/common';
import { DepartmentsController, EmployeesController } from './employees.controller';
import { DocumentsModule } from '../documents/documents.module';
import { EmployeesService } from './employees.service';
import { EmployeeImportService } from './employee-import.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [DocumentsModule, NotificationsModule],
  controllers: [EmployeesController, DepartmentsController],
  providers: [EmployeesService, EmployeeImportService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
