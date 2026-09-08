import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { EmployeesService } from './employees.service';
import { CreateDepartmentDto, CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('employees')
export class EmployeesController {
  constructor(private readonly service: EmployeesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user);
  }

  @Get('org-chart')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER', 'LINE_MANAGER', 'AUDITOR')
  orgChart() {
    return this.service.orgChart();
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.get(id, user);
  }

  @Post()
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  create(@Body() dto: CreateEmployeeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post('bulk-import')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  @UseInterceptors(FileInterceptor('file'))
  bulkImport(@UploadedFile() file: Express.Multer.File) {
    return this.service.bulkImport(file.buffer);
  }

  @Get(':id/documents')
  listDocuments(@Param('id') id: string) {
    return this.service.listDocuments(id);
  }

  @Post(':id/documents')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  @UseInterceptors(FileInterceptor('file'))
  uploadDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('label') label: string,
  ) {
    return this.service.uploadDocument(id, file, label ?? file.originalname);
  }
}

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly service: EmployeesService) {}

  @Get(':id/download-url')
  getDownloadUrl(@Param('id') id: string) {
    return this.service.getDocumentDownloadUrl(id);
  }
}

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly service: EmployeesService) {}

  @Get()
  list() {
    return this.service.listDepartments();
  }

  @Post()
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  create(@Body() dto: CreateDepartmentDto) {
    return this.service.createDepartment(dto);
  }
}
