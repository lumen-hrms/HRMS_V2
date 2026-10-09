import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IndianState, TaxRegime } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { EntitlementGuard } from '../common/guards/entitlement.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresModule } from '../common/decorators/requires-module.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { PayrollConfigService } from './payroll-config.service';
import { SalaryStructureService } from './salary-structure.service';
import { PayrollRunService } from './payroll-run.service';
import { TdsService } from './tds.service';
import { FullAndFinalService } from './full-and-final.service';
import {
  BankFileQueryDto,
  CreatePayrollRunDto,
  GenerateFnfDto,
  PayslipQueryDto,
  PtSlabQueryDto,
  ReplacePtSlabsDto,
  ReplaceTaxSlabsDto,
  ReviseSalaryStructureDto,
  SetLineItemAdjustmentsDto,
  SetTdsRegimeDto,
  TaxConfigQueryDto,
  UpdateFnfAdvanceDto,
  UpdatePayrollSettingsDto,
  UpdateTaxRegimeConfigDto,
  UpsertSalaryStructureDto,
} from './dto/payroll.dto';

@UseGuards(JwtAuthGuard, TenantGuard, EntitlementGuard, RolesGuard)
@RequiresModule('PAYROLL')
@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly structures: SalaryStructureService,
    private readonly config: PayrollConfigService,
    private readonly runs: PayrollRunService,
    private readonly tds: TdsService,
    private readonly fnf: FullAndFinalService,
  ) {}

  // Row scoping (HR/Admin: anyone; Employee: own only) lives in the service.
  @Get('structures/:employeeId')
  getStructure(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.structures.get(employeeId, user);
  }

  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  @Post('structures/:employeeId')
  createStructure(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: UpsertSalaryStructureDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.structures.create(employeeId, dto, user);
  }

  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  @Patch('structures/:employeeId')
  updateStructure(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: UpsertSalaryStructureDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.structures.update(employeeId, dto, user);
  }

  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  @Post('structures/:employeeId/revise')
  reviseStructure(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: ReviseSalaryStructureDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.structures.revise(employeeId, dto, user);
  }

  @Roles('COMPANY_ADMIN', 'HR_MANAGER', 'AUDITOR')
  @Get('config/settings')
  getSettings() {
    return this.config.getSettings();
  }

  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  @Patch('config/settings')
  updateSettings(@Body() dto: UpdatePayrollSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.config.updateSettings(dto, user);
  }

  @Roles('COMPANY_ADMIN', 'HR_MANAGER', 'AUDITOR')
  @Get('config/pt-slabs')
  listPtSlabs(@Query() query: PtSlabQueryDto) {
    return this.config.listPtSlabs(query.state);
  }

  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  @Put('config/pt-slabs/:state')
  replacePtSlabs(
    @Param('state', new ParseEnumPipe(IndianState)) state: IndianState,
    @Body() dto: ReplacePtSlabsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.config.replacePtSlabs(state, dto.slabs, user);
  }

  // ---- Run lifecycle (module 07 §9 Phase 3) ----

  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  @Post('runs')
  createRun(@Body() dto: CreatePayrollRunDto, @CurrentUser() user: AuthenticatedUser) {
    return this.runs.createDraft(dto, user);
  }

  @Roles('COMPANY_ADMIN', 'HR_MANAGER', 'AUDITOR')
  @Get('runs/:id')
  getRun(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.runs.getRun(id, user);
  }

  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  @Patch('runs/:id/line-items/:employeeId')
  setLineItemAdjustments(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: SetLineItemAdjustmentsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.runs.setLineItemAdjustments(id, employeeId, dto.adjustments, user);
  }

  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  @Post('runs/:id/recalculate')
  recalculate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.runs.recalculate(id, user);
  }

  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  @Post('runs/:id/submit-review')
  submitForReview(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.runs.submitForReview(id, user);
  }

  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  @Post('runs/:id/approve')
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.runs.approve(id, user);
  }

  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  @Post('runs/:id/process')
  process(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.runs.process(id, user);
  }

  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  @Post('runs/:id/disburse')
  disburse(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.runs.disburse(id, user);
  }

  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  @Get('runs/:id/bank-file')
  getBankFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: BankFileQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.runs.getBankFile(id, query.format ?? 'CSV', user);
  }

  // ---- Payslips (module 07 §9 Phase 5) ----
  // Row scoping (own only for Employee, any for HR/Admin) lives in the service.

  @Get('payslips/:employeeId')
  getPayslip(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query() query: PayslipQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.runs.getPayslipDownloadUrl(employeeId, query.period, user);
  }

  // ---- TDS and regime choice (module 07 §9 Phase 6) ----

  @Roles('COMPANY_ADMIN', 'HR_MANAGER', 'AUDITOR')
  @Get('config/tax-config')
  getTaxConfig(@Query() query: TaxConfigQueryDto) {
    return this.config.getTaxConfig(query.financialYear);
  }

  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  @Put('config/tax-slabs/:regime')
  replaceTaxSlabs(
    @Param('regime', new ParseEnumPipe(TaxRegime)) regime: TaxRegime,
    @Query() query: TaxConfigQueryDto,
    @Body() dto: ReplaceTaxSlabsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.config.replaceTaxSlabs(query.financialYear, regime, dto.slabs, user);
  }

  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  @Patch('config/tax-regime-config/:regime')
  updateTaxRegimeConfig(
    @Param('regime', new ParseEnumPipe(TaxRegime)) regime: TaxRegime,
    @Query() query: TaxConfigQueryDto,
    @Body() dto: UpdateTaxRegimeConfigDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.config.updateTaxRegimeConfig(query.financialYear, regime, dto, user);
  }

  // Row scoping (own only for Employee, any for HR/Admin) lives in the service.

  @Get('tds-regime/:employeeId')
  getTdsRegime(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query() query: TaxConfigQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tds.getEmployeeRegime(employeeId, query.financialYear, user);
  }

  @Put('tds-regime/:employeeId')
  setTdsRegime(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: SetTdsRegimeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tds.setEmployeeRegime(employeeId, dto, user);
  }

  // ---- Full & Final settlement (module 07 §9 Phase 8) ----
  // Row scoping (own only for Employee, any for HR/Admin/Auditor) lives in the service.

  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  @Post('fnf/:employeeId')
  generateFnf(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: GenerateFnfDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fnf.generate(employeeId, dto, user);
  }

  @Get('fnf/:employeeId')
  getFnf(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fnf.get(employeeId, user);
  }

  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  @Patch('fnf/:employeeId')
  updateFnfAdvance(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: UpdateFnfAdvanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fnf.updateAdvance(employeeId, dto, user);
  }

  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  @Post('fnf/:employeeId/approve')
  approveFnf(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fnf.approve(employeeId, user);
  }

  @Roles('COMPANY_ADMIN', 'HR_MANAGER')
  @Post('fnf/:employeeId/mark-paid')
  markFnfPaid(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fnf.markPaid(employeeId, user);
  }
}
