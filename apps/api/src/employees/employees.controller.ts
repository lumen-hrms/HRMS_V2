import {
  Body,
  Controller,
  Delete,
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
import type { DocumentCategory } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { EmployeesService } from './employees.service';
import { DocumentsService } from '../documents/documents.service';
import {
  CreateDepartmentDto,
  CreateEmployeeDto,
  DeleteDepartmentDto,
  RevealFieldDto,
  TransitionLifecycleDto,
  UpdateDepartmentDto,
  UpdateEmployeeDto,
  UpdateSensitiveFieldsDto,
  UpsertEmergencyContactDto,
  DOCUMENT_CATEGORIES,
} from './dto/employee.dto';

/** `?category=` is a free query string — anything outside the enum is ignored (→ OTHER). */
function toDocumentCategory(value: string | undefined): DocumentCategory | undefined {
  return (DOCUMENT_CATEGORIES as readonly string[]).includes(value ?? '')
    ? (value as DocumentCategory)
    : undefined;
}

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly service: EmployeesService,
    private readonly documents: DocumentsService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user);
  }

  @Get('org-chart')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER', 'LINE_MANAGER', 'AUDITOR', 'EMPLOYEE')
  orgChart(@CurrentUser() user: AuthenticatedUser) {
    return this.service.orgChart(user);
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
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/lifecycle')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  transitionLifecycle(
    @Param('id') id: string,
    @Body() dto: TransitionLifecycleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.transitionLifecycle(id, dto, user);
  }

  @Patch(':id/sensitive-fields')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  updateSensitiveFields(
    @Param('id') id: string,
    @Body() dto: UpdateSensitiveFieldsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateSensitiveFields(id, dto, user);
  }

  @Post(':id/reveal')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER', 'AUDITOR')
  revealField(
    @Param('id') id: string,
    @Body() dto: RevealFieldDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.revealField(id, dto, user);
  }

  @Get(':id/emergency-contacts')
  listEmergencyContacts(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.listEmergencyContacts(id, user);
  }

  @Post(':id/emergency-contacts')
  createEmergencyContact(
    @Param('id') id: string,
    @Body() dto: UpsertEmergencyContactDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createEmergencyContact(id, dto, user);
  }

  @Patch(':id/emergency-contacts/:contactId')
  updateEmergencyContact(
    @Param('id') id: string,
    @Param('contactId') contactId: string,
    @Body() dto: UpsertEmergencyContactDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateEmergencyContact(id, contactId, dto, user);
  }

  @Delete(':id/emergency-contacts/:contactId')
  deleteEmergencyContact(
    @Param('id') id: string,
    @Param('contactId') contactId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.deleteEmergencyContact(id, contactId, user);
  }

  @Post('bulk-import')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  @UseInterceptors(FileInterceptor('file'))
  bulkImport(@UploadedFile() file: Express.Multer.File) {
    return this.service.bulkImport(file.buffer);
  }

  @Get(':id/documents')
  listDocuments(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documents.listProfileDocuments(id, user);
  }

  @Post(':id/photo')
  @UseInterceptors(FileInterceptor('file'))
  uploadPhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.uploadPhoto(id, file, user);
  }

  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file'))
  uploadDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('label') label: string,
    @Query('category') category: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.uploadProfileDocument(
      id,
      file,
      label,
      toDocumentCategory(category),
      user,
    );
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

  @Patch(':id')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
    return this.service.updateDepartment(id, dto);
  }

  @Delete(':id')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  delete(@Param('id') id: string, @Body() dto: DeleteDepartmentDto) {
    return this.service.deleteDepartment(id, dto);
  }
}
