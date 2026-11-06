import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import type { TenantResolvedRequest } from '../common/tenancy/tenant-resolution.middleware';
import { MAX_IMPORT_FILE_BYTES } from '../common/bulk-import';
import { SetupService } from './setup.service';
import type { SetupDraft } from './setup.types';

const FILE_KINDS = ['employees', 'balances'] as const;
type FileKind = (typeof FILE_KINDS)[number];

function fileKind(kind: string): FileKind {
  if (!(FILE_KINDS as readonly string[]).includes(kind)) {
    throw new BadRequestException(`Unknown setup file "${kind}" — expected employees or balances`);
  }
  return kind as FileKind;
}

/**
 * Company setup (module 13). `/api/setup/*` is the one route family
 * `TenantGuard` lets through while setup is incomplete. Everything except
 * `status` is Company Admin only; `status` is what every other role's web
 * app polls to show "your workspace is being set up".
 */
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('setup')
export class SetupController {
  constructor(private readonly service: SetupService) {}

  @Get('status')
  status() {
    return this.service.getStatus();
  }

  @Get('draft')
  @Roles('COMPANY_ADMIN')
  getDraft(@CurrentUser() user: AuthenticatedUser, @Req() req: TenantResolvedRequest) {
    return this.service.getDraft(user, req.tenantName ?? '');
  }

  @Put('draft')
  @Roles('COMPANY_ADMIN')
  saveDraft(@CurrentUser() user: AuthenticatedUser, @Body() body: { draft: Partial<SetupDraft> }) {
    return this.service.saveDraft(user, body?.draft);
  }

  @Post('validate')
  @Roles('COMPANY_ADMIN')
  validate(@CurrentUser() user: AuthenticatedUser) {
    return this.service.validate(user);
  }

  @Post('files/:kind')
  @Roles('COMPANY_ADMIN')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_BYTES } }))
  uploadFile(
    @Param('kind') kind: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.uploadFile(user, fileKind(kind), file);
  }

  @Delete('files/:kind')
  @Roles('COMPANY_ADMIN')
  removeFile(@Param('kind') kind: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.removeFile(user, fileKind(kind));
  }

  @Post('holidays/import')
  @Roles('COMPANY_ADMIN')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_BYTES } }))
  importHolidays(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.importHolidays(user, file?.buffer);
  }

  @Post('submit')
  @Roles('COMPANY_ADMIN')
  submit(@CurrentUser() user: AuthenticatedUser) {
    return this.service.submit(user);
  }

  @Post('logins/retry')
  @Roles('COMPANY_ADMIN')
  retryLogins(@CurrentUser() user: AuthenticatedUser) {
    return this.service.retryLogins(user);
  }
}
