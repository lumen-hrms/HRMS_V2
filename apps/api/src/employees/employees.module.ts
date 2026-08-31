import { Module } from '@nestjs/common';
import {
  DepartmentsController,
  DocumentsController,
  EmployeesController,
} from './employees.controller';
import { EmployeesService } from './employees.service';

@Module({
  controllers: [EmployeesController, DocumentsController, DepartmentsController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
