import { Module } from '@nestjs/common';
import { DepartmentsController, EmployeesController } from './employees.controller';
import { DocumentsModule } from '../documents/documents.module';
import { EmployeesService } from './employees.service';

@Module({
  imports: [DocumentsModule],
  controllers: [EmployeesController, DepartmentsController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
