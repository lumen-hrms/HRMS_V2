import { Body, Controller, Delete, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import type { DocumentCategory } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { DOCUMENT_CATEGORIES } from '../employees/dto/employee.dto';
import { DocumentsService } from './documents.service';

export class SetDocumentCategoryDto {
  @IsIn(DOCUMENT_CATEGORIES)
  category!: DocumentCategory;
}

/**
 * Owner-agnostic document routes (module 09 §4.5). Uploads live on the
 * owner's own route (`/employees/:id/documents`,
 * `/leave/requests/:id/attachment`, `/attendance/regularization/:id/evidence`)
 * because each owner type has its own upload rules.
 */
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  @Get(':id/download-url')
  getDownloadUrl(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.getDownloadUrl(id, user);
  }

  @Patch(':id/category')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  setCategory(
    @Param('id') id: string,
    @Body() dto: SetDocumentCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setCategory(id, dto.category, user);
  }

  @Delete(':id')
  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  delete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.softDelete(id, user);
  }
}
