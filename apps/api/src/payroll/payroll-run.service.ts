import { mapWithConcurrency } from './concurrency.util';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, type SalaryCalculationMode, type SalaryComponentType } from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import { HR_ROLES, NotificationDispatcher } from '../notifications/notification-dispatcher.service';
import { StorageService } from '../storage/storage.service';
import { FieldEncryptionService } from '../crypto/field-encryption.service';
import { PayrollConfigService } from './payroll-config.service';
import { writePayrollAudit } from './payroll-audit';
import {
  calculatePayroll,
  PayrollCalculationError,
  type PayrollCalculationResult,
} from './payroll-calculator';
import { computePayableDays, effectiveWeeklyOffDays, monthRange } from './working-days.util';
import type { PtSlabRow } from './professional-tax.util';
import { BASIC_CODE, resolveMonthlyAmounts } from './salary-components.util';
import type { AdHocAdjustmentDto, CreatePayrollRunDto } from './dto/payroll.dto';
import { generatePayslipPdf } from './payslip-generator';
import { BANK_FILE_GENERATORS, type BankFileRow } from './bank-file-generator';
import { TdsService, type EmployeeTdsContext } from './tds.service';
import { computeMonthlyTds } from './tds-calculator';

const MANAGE_ROLES = ['COMPANY_ADMIN', 'HR_MANAGER'];

interface LineItemException {
  employeeId?: string;
  type:
    | 'NO_WORK_STATE'
    | 'NO_SALARY_STRUCTURE'
    | 'CALCULATION_ERROR'
    | 'PENDING_REGULARIZATIONS'
    | 'NO_DOB_FOR_PAYSLIP';
  detail: string;
}

interface LineItemCompute {
  employeeId: string;
  calculationSnapshot: Record<string, unknown>;
  workingDays: number;
  payableDays: number;
  lopDays: number;
  grossEarnings: Prisma.Decimal;
  epfEmployee: Prisma.Decimal;
  epfEmployer: Prisma.Decimal;
  esiEmployee: Prisma.Decimal;
  esiEmployer: Prisma.Decimal;
  professionalTax: Prisma.Decimal;
  tdsDeducted: Prisma.Decimal;
  netPay: Prisma.Decimal;
  /** Folded-in arrears from a backdated salary revision (module 07 Phase 7). Absent = none. */
  adHocAdjustments?: AdHocAdjustmentDto[];
}

function snapshotToJson(result: PayrollCalculationResult) {
  return {
    workingDays: result.workingDays,
    payableDays: result.payableDays,
    payableFactor: result.payableFactor.toNumber(),
    earnings: result.earnings.map((e) => ({
      type: e.type,
      code: e.code,
      fullMonthlyAmount: e.fullMonthlyAmount.toNumber(),
      proratedAmount: e.proratedAmount.toNumber(),
    })),
    grossEarnings: result.grossEarnings.toNumber(),
    lopDeduction: result.lopDeduction.toNumber(),
    overtimePay: result.overtimePay.toNumber(),
    epf: {
      wages: result.epf.wages.toNumber(),
      employeeContribution: result.epf.employeeContribution.toNumber(),
      epsContribution: result.epf.epsContribution.toNumber(),
      employerPfContribution: result.epf.employerPfContribution.toNumber(),
      adminCharge: result.epf.adminCharge.toNumber(),
      edliContribution: result.epf.edliContribution.toNumber(),
    },
    esi: {
      applicable: result.esi.applicable,
      wages: result.esi.wages.toNumber(),
      employeeContribution: result.esi.employeeContribution.toNumber(),
      employerContribution: result.esi.employerContribution.toNumber(),
    },
    professionalTax: result.professionalTax.toNumber(),
    tds: result.tds.toNumber(),
    totalDeductions: result.totalDeductions.toNumber(),
    netPay: result.netPay.toNumber(),
  };
}

const PAYSLIP_CONCURRENCY = 10;
const NOTIFY_CONCURRENCY = 10;

@Injectable()
export class PayrollRunService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly config: PayrollConfigService,
    private readonly attendance: AttendanceService,
    private readonly notifications: NotificationDispatcher,
    private readonly storage: StorageService,
    private readonly fieldEncryption: FieldEncryptionService,
    private readonly tds: TdsService,
  ) {}

  /** INV-4: Payroll (run creation/approval) stays blocked below two active Company Admins. */
  private async assertPayrollGate() {
    const activeAdmins = await this.tenantPrisma.client.user.count({
      where: { role: 'COMPANY_ADMIN', isActive: true },
    });
    if (activeAdmins < 2) {
      throw new ConflictException(
        'Payroll is locked until this tenant has at least two active Company Admins (module 07 INV-4)',
      );
    }
  }

  private assertCanManage(user: AuthenticatedUser) {
    if (!MANAGE_ROLES.includes(user.role)) {
      throw new ForbiddenException('Not authorized to manage payroll runs');
    }
  }

  private async notifyStatusChange(
    run: { id: string; period: string },
    status: 'REVIEW' | 'APPROVED' | 'PROCESSED' | 'DISBURSED',
    actorUserId: string,
  ) {
    await this.notifications.notify({
      tenantId: this.tenantPrisma.tenantId,
      template: 'PAYROLL_RUN_STATUS_CHANGED',
      context: { period: run.period, status },
      dedupeKey: `payroll:${run.id}:status:${status}`,
      to: { roles: HR_ROLES },
      actorUserId,
    });
  }

  /**
   * One employee's line-item figures for `period`, or an exception if they
   * can't be included (RULE-7). Pure given its inputs — no DB access — so
   * both initial assembly and `recalculate` share it.
   */
  private computeLineItem(
    emp: {
      id: string;
      workState: string | null;
      weeklyOffDaysOverride: number[];
      dateOfJoining: Date | null;
      salaryStructures: Array<{
        ctcAnnual: Prisma.Decimal;
        components: Array<{
          type: SalaryComponentType;
          code: string;
          calculationMode: SalaryCalculationMode;
          value: Prisma.Decimal | null;
          formula: string | null;
        }>;
      }>;
    },
    period: string,
    settings: {
      epfCeiling: Prisma.Decimal;
      allowEpfAboveCeiling: boolean;
      epfEmployeeRate: Prisma.Decimal;
      epsRate: Prisma.Decimal;
      epfEmployerRate: Prisma.Decimal;
      epfAdminRate: Prisma.Decimal;
      edliRate: Prisma.Decimal;
      esiWageCeiling: Prisma.Decimal;
      esiEmployeeRate: Prisma.Decimal;
      esiEmployerRate: Prisma.Decimal;
      overtimeEnabled: boolean;
      overtimeMultiplier: Prisma.Decimal;
    },
    tenantWeeklyOffDays: number[],
    holidayDates: Set<string>,
    ptSlabsByState: Map<string, PtSlabRow[]>,
    lopDays: number,
    /** Approved CASH overtime hours + the shift hours/day to rate them against (0 = none). */
    overtime: { hours: number; shiftHours: number },
    tdsContext: EmployeeTdsContext,
  ): { lineItem: LineItemCompute } | { exception: LineItemException } {
    if (!emp.workState) {
      return {
        exception: { employeeId: emp.id, type: 'NO_WORK_STATE', detail: 'No workState set' },
      };
    }
    const structure = emp.salaryStructures[0];
    if (!structure) {
      return {
        exception: {
          employeeId: emp.id,
          type: 'NO_SALARY_STRUCTURE',
          detail: 'No active salary structure',
        },
      };
    }

    const { start, end } = monthRange(period);
    const inclusiveEnd = new Date(end.getTime() - 1);
    const weeklyOffDays = effectiveWeeklyOffDays(tenantWeeklyOffDays, emp.weeklyOffDaysOverride);
    const employedFrom =
      emp.dateOfJoining && emp.dateOfJoining > start ? emp.dateOfJoining : undefined;
    const { workingDays, payableDays } = computePayableDays(
      start,
      inclusiveEnd,
      holidayDates,
      weeklyOffDays,
      lopDays,
      employedFrom,
    );

    const month = Number(period.split('-')[1]);
    try {
      let overtimeInput:
        | { hours: Prisma.Decimal; hourlyRate: Prisma.Decimal; multiplier: Prisma.Decimal }
        | undefined;
      if (
        settings.overtimeEnabled &&
        overtime.hours > 0 &&
        overtime.shiftHours > 0 &&
        workingDays > 0
      ) {
        const fullMonthlyBasic = resolveMonthlyAmounts(
          structure.components,
          structure.ctcAnnual,
        ).get(BASIC_CODE)!;
        const hourlyRate = fullMonthlyBasic.div(workingDays * overtime.shiftHours);
        overtimeInput = {
          hours: new Prisma.Decimal(overtime.hours),
          hourlyRate,
          multiplier: settings.overtimeMultiplier,
        };
      }

      const calculatorInput = {
        components: structure.components,
        ctcAnnual: structure.ctcAnnual,
        workingDays,
        payableDays,
        epf: {
          ceiling: settings.epfCeiling,
          allowAboveCeiling: settings.allowEpfAboveCeiling,
          employeeRate: settings.epfEmployeeRate,
          epsRate: settings.epsRate,
          employerRate: settings.epfEmployerRate,
          adminRate: settings.epfAdminRate,
          edliRate: settings.edliRate,
        },
        esi: {
          wageCeiling: settings.esiWageCeiling,
          employeeRate: settings.esiEmployeeRate,
          employerRate: settings.esiEmployerRate,
        },
        ptSlabs: ptSlabsByState.get(emp.workState) ?? [],
        month,
        overtime: overtimeInput,
      };

      // Gross earnings don't depend on tds, so a cheap provisional pass
      // (tds=0) gives the one figure the TDS projection needs; the real
      // pass then recomputes net pay with the actual monthly TDS (module
      // 07 §9 Phase 6).
      const provisional = calculatePayroll(calculatorInput);
      const tdsAmount = computeMonthlyTds({
        regime: tdsContext.regime,
        currentMonthGross: provisional.grossEarnings,
        elapsedGross: tdsContext.elapsedGross,
        alreadyDeducted: tdsContext.alreadyDeducted,
        remainingMonths: tdsContext.remainingMonths,
        declaredExemptions: tdsContext.declaredExemptions,
        slabs: tdsContext.slabs,
        config: tdsContext.config,
      });
      const result = tdsAmount.isZero()
        ? provisional
        : calculatePayroll({ ...calculatorInput, tds: tdsAmount });

      const epfEmployer = result.epf.epsContribution
        .plus(result.epf.employerPfContribution)
        .plus(result.epf.adminCharge)
        .plus(result.epf.edliContribution);

      return {
        lineItem: {
          employeeId: emp.id,
          calculationSnapshot: snapshotToJson(result),
          workingDays,
          payableDays,
          lopDays,
          grossEarnings: result.grossEarnings,
          epfEmployee: result.epf.employeeContribution,
          epfEmployer,
          esiEmployee: result.esi.employeeContribution,
          esiEmployer: result.esi.employerContribution,
          professionalTax: result.professionalTax,
          tdsDeducted: result.tds,
          netPay: result.netPay,
        },
      };
    } catch (e) {
      if (e instanceof PayrollCalculationError) {
        return { exception: { employeeId: emp.id, type: 'CALCULATION_ERROR', detail: e.message } };
      }
      throw e;
    }
  }

  private async assembleLineItems(period: string) {
    const tenantId = this.tenantPrisma.tenantId;
    const { start, end } = monthRange(period);

    const [
      settings,
      tenantSettings,
      employees,
      lopMap,
      overtimeMap,
      pendingRegularizations,
      ptSlabRows,
    ] = await Promise.all([
      this.config.getSettings(),
      this.tenantPrisma.client.tenantSettings.findUniqueOrThrow({ where: { tenantId } }),
      this.tenantPrisma.client.employee.findMany({
        where: { lifecycleState: { notIn: ['SEPARATED', 'PRE_JOINING'] } },
        include: {
          salaryStructures: { where: { status: 'ACTIVE' }, include: { components: true } },
        },
      }),
      this.attendance.getLopDaysBatch(period),
      this.attendance.getApprovedOvertimeBatch(period),
      this.tenantPrisma.client.regularizationRequest.count({
        where: { status: 'PENDING', targetDate: { gte: start, lt: end } },
      }),
      this.tenantPrisma.client.professionalTaxSlab.findMany({ orderBy: { grossFrom: 'asc' } }),
    ]);

    const holidays = await this.tenantPrisma.client.holiday.findMany({
      where: { date: { gte: start, lt: end } },
      select: { date: true },
    });
    const holidayDates = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));

    const ptSlabsByState = new Map<string, PtSlabRow[]>();
    for (const slab of ptSlabRows) {
      const arr = ptSlabsByState.get(slab.state) ?? [];
      arr.push(slab);
      ptSlabsByState.set(slab.state, arr);
    }

    const tdsContexts = await this.tds.buildContext(
      employees.map((e) => e.id),
      period,
    );
    const pendingArrears = await this.tenantPrisma.client.arrearsLineItem.findMany({
      where: { employeeId: { in: employees.map((e) => e.id) }, status: 'PENDING' },
    });
    const arrearsByEmployee = new Map<string, typeof pendingArrears>();
    for (const a of pendingArrears) {
      const arr = arrearsByEmployee.get(a.employeeId) ?? [];
      arr.push(a);
      arrearsByEmployee.set(a.employeeId, arr);
    }

    const lineItems: LineItemCompute[] = [];
    const exceptions: LineItemException[] = [];
    const foldedArrearsIds: string[] = [];
    for (const emp of employees) {
      const otHours = overtimeMap.get(emp.id) ?? 0;
      const shiftHours =
        settings.overtimeEnabled && otHours > 0 ? await this.attendance.getShiftHours(emp.id) : 0;
      const outcome = this.computeLineItem(
        emp,
        period,
        settings,
        tenantSettings.weeklyOffDays,
        holidayDates,
        ptSlabsByState,
        lopMap.get(emp.id) ?? 0,
        { hours: otHours, shiftHours },
        tdsContexts.get(emp.id)!,
      );
      if ('exception' in outcome) {
        exceptions.push(outcome.exception);
        continue;
      }
      // Fold any pending arrears from a backdated salary revision into
      // this employee's first new line item (module 07 Phase 7, decision
      // 25: "next open run") — one ad-hoc adjustment per corrected period.
      const arrears = arrearsByEmployee.get(emp.id);
      if (arrears?.length) {
        outcome.lineItem.adHocAdjustments = arrears.map((a) => ({
          type: 'ARREARS',
          amount: a.amount.toNumber(),
          note: `Salary revision arrears for ${a.period}`,
        }));
        outcome.lineItem.netPay = outcome.lineItem.netPay.plus(
          arrears.reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0)),
        );
        foldedArrearsIds.push(...arrears.map((a) => a.id));
      }
      lineItems.push(outcome.lineItem);
    }

    if (pendingRegularizations > 0) {
      // A warning, not a block (the spec leaves "block or warn" open) — HR
      // can still proceed, but the run may need a recalculate once these
      // are decided.
      exceptions.push({
        type: 'PENDING_REGULARIZATIONS',
        detail: `${pendingRegularizations} regularization request(s) for ${period} are still PENDING — attendance for the period may still change`,
      });
    }

    return { lineItems, exceptions, foldedArrearsIds };
  }

  async createDraft(dto: CreatePayrollRunDto, user: AuthenticatedUser) {
    this.assertCanManage(user);
    await this.assertPayrollGate();
    if (dto.isReprocess && !dto.reprocessReason) {
      throw new BadRequestException('A re-process requires a reason');
    }
    const tenantId = this.tenantPrisma.tenantId;

    if (!dto.isReprocess) {
      const existing = await this.tenantPrisma.client.payrollRun.findFirst({
        where: { period: dto.period, isReprocess: false },
      });
      if (existing) {
        throw new ConflictException(
          `A run for ${dto.period} already exists; create a re-process with a reason to run it again`,
        );
      }
    }

    const { lineItems, exceptions, foldedArrearsIds } = await this.assembleLineItems(dto.period);
    const runId = randomUUID();

    try {
      await this.tenantPrisma.transaction((tx) => [
        tx.payrollRun.create({
          data: {
            id: runId,
            tenantId,
            period: dto.period,
            preparedBy: user.sub,
            isReprocess: dto.isReprocess ?? false,
            reprocessReason: dto.reprocessReason ?? null,
            exceptions: exceptions as unknown as Prisma.InputJsonValue,
          },
        }),
        ...(lineItems.length
          ? [
              tx.payrollLineItem.createMany({
                data: lineItems.map((li) => ({
                  ...li,
                  runId,
                  tenantId,
                  calculationSnapshot: li.calculationSnapshot as unknown as Prisma.InputJsonValue,
                  adHocAdjustments: (li.adHocAdjustments ?? []) as unknown as Prisma.InputJsonValue,
                })),
              }),
            ]
          : []),
        ...(foldedArrearsIds.length
          ? [
              tx.arrearsLineItem.updateMany({
                where: { id: { in: foldedArrearsIds } },
                data: { status: 'FOLDED', foldedIntoRunId: runId },
              }),
            ]
          : []),
      ]);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(
          `A run for ${dto.period} already exists; create a re-process with a reason to run it again`,
        );
      }
      throw e;
    }

    await writePayrollAudit(this.tenantPrisma, user, 'payroll.run_created', 'payroll_run', runId, {
      period: dto.period,
      isReprocess: dto.isReprocess ?? false,
      lineItemCount: lineItems.length,
      exceptionCount: exceptions.length,
      arrearsFoldedCount: foldedArrearsIds.length,
    });

    return this.getRun(runId, user);
  }

  async recalculate(runId: string, user: AuthenticatedUser) {
    this.assertCanManage(user);
    const run = await this.getRunOrThrow(runId);
    if (run.status !== 'DRAFT' && run.status !== 'REVIEW') {
      throw new ConflictException('Only a DRAFT or REVIEW run can be recalculated');
    }

    const existingItems = await this.tenantPrisma.client.payrollLineItem.findMany({
      where: { runId },
    });
    const { start, end } = monthRange(run.period);
    const [settings, tenantSettings, employees, lopMap, overtimeMap, ptSlabRows, holidays] =
      await Promise.all([
        this.config.getSettings(),
        this.tenantPrisma.client.tenantSettings.findUniqueOrThrow({
          where: { tenantId: this.tenantPrisma.tenantId },
        }),
        this.tenantPrisma.client.employee.findMany({
          where: { id: { in: existingItems.map((li) => li.employeeId) } },
          include: {
            salaryStructures: { where: { status: 'ACTIVE' }, include: { components: true } },
          },
        }),
        this.attendance.getLopDaysBatch(run.period),
        this.attendance.getApprovedOvertimeBatch(run.period),
        this.tenantPrisma.client.professionalTaxSlab.findMany({ orderBy: { grossFrom: 'asc' } }),
        this.tenantPrisma.client.holiday.findMany({
          where: { date: { gte: start, lt: end } },
          select: { date: true },
        }),
      ]);
    const employeesById = new Map(employees.map((e) => [e.id, e]));
    const holidayDates = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
    const ptSlabsByState = new Map<string, PtSlabRow[]>();
    for (const slab of ptSlabRows) {
      const arr = ptSlabsByState.get(slab.state) ?? [];
      arr.push(slab);
      ptSlabsByState.set(slab.state, arr);
    }
    const tdsContexts = await this.tds.buildContext(
      employees.map((e) => e.id),
      run.period,
    );

    const updates: Array<{ id: string; data: Prisma.PayrollLineItemUpdateInput }> = [];
    for (const item of existingItems) {
      const emp = employeesById.get(item.employeeId);
      if (!emp) {
        throw new ConflictException(`Employee ${item.employeeId} no longer exists`);
      }
      const otHours = overtimeMap.get(emp.id) ?? 0;
      const shiftHours =
        settings.overtimeEnabled && otHours > 0 ? await this.attendance.getShiftHours(emp.id) : 0;
      const outcome = this.computeLineItem(
        emp,
        run.period,
        settings,
        tenantSettings.weeklyOffDays,
        holidayDates,
        ptSlabsByState,
        lopMap.get(emp.id) ?? 0,
        { hours: otHours, shiftHours },
        tdsContexts.get(emp.id)!,
      );
      if ('exception' in outcome) {
        throw new ConflictException(
          `Recalculation failed for employee ${item.employeeId}: ${outcome.exception.detail}`,
        );
      }

      const adjustments = (item.adHocAdjustments as unknown as AdHocAdjustmentDto[]) ?? [];
      const adjustmentTotal = adjustments.reduce((sum, a) => sum + a.amount, 0);
      const computed = outcome.lineItem;
      updates.push({
        id: item.id,
        data: {
          calculationSnapshot: computed.calculationSnapshot as unknown as Prisma.InputJsonValue,
          workingDays: computed.workingDays,
          payableDays: computed.payableDays,
          lopDays: computed.lopDays,
          grossEarnings: computed.grossEarnings,
          epfEmployee: computed.epfEmployee,
          epfEmployer: computed.epfEmployer,
          esiEmployee: computed.esiEmployee,
          esiEmployer: computed.esiEmployer,
          professionalTax: computed.professionalTax,
          tdsDeducted: computed.tdsDeducted,
          netPay: computed.netPay.plus(adjustmentTotal),
        },
      });
    }

    await this.tenantPrisma.transaction((tx) =>
      updates.map((u) => tx.payrollLineItem.update({ where: { id: u.id }, data: u.data })),
    );

    await writePayrollAudit(
      this.tenantPrisma,
      user,
      'payroll.run_recalculated',
      'payroll_run',
      runId,
      { lineItemCount: updates.length },
    );
    return this.getRun(runId, user);
  }

  async setLineItemAdjustments(
    runId: string,
    employeeId: string,
    adjustments: AdHocAdjustmentDto[],
    user: AuthenticatedUser,
  ) {
    this.assertCanManage(user);
    const run = await this.getRunOrThrow(runId);
    if (run.status !== 'DRAFT' && run.status !== 'REVIEW') {
      throw new ConflictException('Line items can only be adjusted while DRAFT or REVIEW');
    }
    const item = await this.tenantPrisma.client.payrollLineItem.findUnique({
      where: { runId_employeeId: { runId, employeeId } },
    });
    if (!item) throw new NotFoundException('No line item for this employee in this run');

    const baseNet = item.grossEarnings
      .minus(item.epfEmployee)
      .minus(item.esiEmployee)
      .minus(item.professionalTax)
      .minus(item.tdsDeducted);
    const adjustmentTotal = adjustments.reduce((sum, a) => sum + a.amount, 0);

    const updated = await this.tenantPrisma.client.payrollLineItem.update({
      where: { id: item.id },
      data: {
        adHocAdjustments: adjustments as unknown as Prisma.InputJsonValue,
        netPay: baseNet.plus(adjustmentTotal),
      },
    });

    await writePayrollAudit(
      this.tenantPrisma,
      user,
      'payroll.line_item_adjusted',
      'employee',
      employeeId,
      { runId, adjustmentCount: adjustments.length },
    );
    return updated;
  }

  async submitForReview(runId: string, user: AuthenticatedUser) {
    this.assertCanManage(user);
    const run = await this.getRunOrThrow(runId);
    if (run.status !== 'DRAFT') throw new ConflictException('Only a DRAFT run can be submitted');

    await this.tenantPrisma.client.payrollRun.update({
      where: { id: runId },
      data: { status: 'REVIEW' },
    });
    await writePayrollAudit(
      this.tenantPrisma,
      user,
      'payroll.run_submitted_for_review',
      'payroll_run',
      runId,
      {},
    );
    await this.notifyStatusChange(run, 'REVIEW', user.sub);
    return this.getRun(runId, user);
  }

  /** INV-1: two distinct approvers; the same account approving twice counts once. */
  async approve(runId: string, user: AuthenticatedUser) {
    this.assertCanManage(user);
    await this.assertPayrollGate();
    const run = await this.getRunOrThrow(runId);
    if (run.status !== 'REVIEW') {
      throw new ConflictException('Only a run under REVIEW can be approved');
    }

    await this.tenantPrisma.client.payrollRunApproval.upsert({
      where: { runId_approverId: { runId, approverId: user.sub } },
      create: { tenantId: this.tenantPrisma.tenantId, runId, approverId: user.sub },
      update: {},
    });

    const distinctApprovers = await this.tenantPrisma.client.payrollRunApproval.count({
      where: { runId },
    });

    if (distinctApprovers >= 2) {
      await this.tenantPrisma.client.payrollRun.update({
        where: { id: runId },
        data: { status: 'APPROVED' },
      });
      await writePayrollAudit(
        this.tenantPrisma,
        user,
        'payroll.run_approved',
        'payroll_run',
        runId,
        { distinctApprovers },
      );
      await this.notifyStatusChange(run, 'APPROVED', user.sub);
    } else {
      await writePayrollAudit(
        this.tenantPrisma,
        user,
        'payroll.run_approval_recorded',
        'payroll_run',
        runId,
        { distinctApprovers },
      );
    }
    return this.getRun(runId, user);
  }

  /**
   * APPROVED -> PROCESSED: the immutability boundary (INV-2) — line items
   * become unwritable from here (DB trigger). Generates a payslip PDF per
   * employee with a `dateOfBirth` on file (RULE-3; others are excluded and
   * listed as a `NO_DOB_FOR_PAYSLIP` exception, never an unprotected PDF).
   * The bank file is generated on demand (`getBankFile`), not stored here.
   */
  async process(runId: string, user: AuthenticatedUser) {
    this.assertCanManage(user);
    const run = await this.getRunOrThrow(runId);
    if (run.status !== 'APPROVED') {
      throw new ConflictException('Only an APPROVED run can be processed');
    }
    const tenantId = this.tenantPrisma.tenantId;

    const lineItems = await this.tenantPrisma.client.payrollLineItem.findMany({
      where: { runId },
    });
    const employees = await this.tenantPrisma.client.employee.findMany({
      where: { id: { in: lineItems.map((li) => li.employeeId) } },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, dateOfBirth: true },
    });
    const employeesById = new Map(employees.map((e) => [e.id, e]));

    const payslipExceptions: LineItemException[] = [];
    const notifyEmployeeIds: string[] = [];
    const keyUpdates: Array<{ id: string; key: string }> = [];
    const payslipTargets: Array<{
      item: (typeof lineItems)[number];
      emp: (typeof employees)[number] & { dateOfBirth: Date };
    }> = [];
    for (const item of lineItems) {
      const emp = employeesById.get(item.employeeId);
      if (!emp?.dateOfBirth) {
        payslipExceptions.push({
          employeeId: item.employeeId,
          type: 'NO_DOB_FOR_PAYSLIP',
          detail: 'No dateOfBirth on file — payslip not generated',
        });
        continue;
      }
      payslipTargets.push({ item, emp: emp as (typeof payslipTargets)[number]['emp'] });
    }

    // Generate + upload with bounded concurrency: 5,000 sequential S3 PUTs
    // would hold this request open for minutes (module 07 Phase 9).
    const generated = await mapWithConcurrency(
      payslipTargets,
      PAYSLIP_CONCURRENCY,
      async ({ item, emp }) => {
        const snapshot = item.calculationSnapshot as unknown as {
          earnings: Array<{ code: string; proratedAmount: number }>;
        };
        const buffer = await generatePayslipPdf({
          employeeName: `${emp.firstName} ${emp.lastName}`,
          employeeCode: emp.employeeCode,
          period: run.period,
          dateOfBirth: emp.dateOfBirth,
          workingDays: item.workingDays,
          payableDays: item.payableDays,
          lopDays: item.lopDays,
          earnings: snapshot.earnings.map((e) => ({ code: e.code, amount: e.proratedAmount })),
          grossEarnings: item.grossEarnings.toNumber(),
          epfEmployee: item.epfEmployee.toNumber(),
          esiEmployee: item.esiEmployee.toNumber(),
          professionalTax: item.professionalTax.toNumber(),
          tdsDeducted: item.tdsDeducted.toNumber(),
          adHocAdjustments: (item.adHocAdjustments as unknown as AdHocAdjustmentDto[]) ?? [],
          netPay: item.netPay.toNumber(),
        });
        const key = this.storage.buildKey(
          tenantId,
          item.employeeId,
          `payslip-${run.period}.pdf`,
          'payslip',
        );
        await this.storage.upload(key, buffer, 'application/pdf');
        return { id: item.id, key, employeeId: item.employeeId };
      },
    );
    for (const g of generated) {
      keyUpdates.push({ id: g.id, key: g.key });
      notifyEmployeeIds.push(g.employeeId);
    }

    const mergedExceptions = [
      ...(Array.isArray(run.exceptions) ? (run.exceptions as unknown as LineItemException[]) : []),
      ...payslipExceptions,
    ];

    // The line-item writes must land BEFORE the run flips to PROCESSED, in
    // the same transaction — the INV-2 trigger reads the run's status at
    // UPDATE time, so it still sees APPROVED for these statements.
    await this.tenantPrisma.transaction((tx) => [
      ...keyUpdates.map((k) =>
        tx.payrollLineItem.update({ where: { id: k.id }, data: { payslipFileKey: k.key } }),
      ),
      tx.payrollRun.update({
        where: { id: runId },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          exceptions: mergedExceptions as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);

    await writePayrollAudit(
      this.tenantPrisma,
      user,
      'payroll.run_processed',
      'payroll_run',
      runId,
      { payslipsGenerated: keyUpdates.length, payslipExceptions: payslipExceptions.length },
    );
    await this.notifyStatusChange(run, 'PROCESSED', user.sub);
    await mapWithConcurrency(notifyEmployeeIds, NOTIFY_CONCURRENCY, (employeeId) =>
      this.notifications.notify({
        tenantId,
        template: 'PAYSLIP_READY',
        context: { period: run.period },
        dedupeKey: `payroll:${runId}:payslip:${employeeId}`,
        to: { employeeIds: [employeeId] },
        actorUserId: user.sub,
      }),
    );
    return this.getRun(runId, user);
  }

  /**
   * Own payslip (employee) or any (HR/Admin) — a short-lived presigned URL,
   * same pattern as Documents. 404 if the period has no processed run, or
   * that employee was excluded from payslip generation (missing DOB).
   */
  async getPayslipDownloadUrl(employeeId: string, period: string, user: AuthenticatedUser) {
    if (!MANAGE_ROLES.includes(user.role) && user.employeeId !== employeeId) {
      throw new ForbiddenException("Not authorized to view this employee's payslip");
    }
    const run = await this.tenantPrisma.client.payrollRun.findFirst({
      where: { period, status: { in: ['PROCESSED', 'DISBURSED'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!run) throw new NotFoundException('No processed payroll run for this period');

    const item = await this.tenantPrisma.client.payrollLineItem.findUnique({
      where: { runId_employeeId: { runId: run.id, employeeId } },
    });
    if (!item?.payslipFileKey) {
      throw new NotFoundException('No payslip available for this employee/period');
    }
    const url = await this.storage.getPresignedDownloadUrl(
      item.payslipFileKey,
      300,
      `payslip-${period}.pdf`,
    );
    return { url, expiresInSeconds: 300 };
  }

  /**
   * Disbursement file (FR-PAY-015, §12 decision 12) — generated on demand
   * from the (immutable, once PROCESSED) line items, not pre-generated and
   * stored, since the only implementation today is a dummy generic CSV.
   */
  async getBankFile(runId: string, format: string, user: AuthenticatedUser) {
    this.assertCanManage(user);
    const run = await this.getRunOrThrow(runId);
    if (run.status !== 'PROCESSED' && run.status !== 'DISBURSED') {
      throw new ConflictException('The bank file is only available once a run is PROCESSED');
    }
    const generator = BANK_FILE_GENERATORS[format];
    if (!generator) {
      throw new BadRequestException(
        `Bank file format "${format}" is not implemented yet — only ${Object.keys(BANK_FILE_GENERATORS).join(', ')} available`,
      );
    }

    const lineItems = await this.tenantPrisma.client.payrollLineItem.findMany({ where: { runId } });
    const employees = await this.tenantPrisma.client.employee.findMany({
      where: { id: { in: lineItems.map((li) => li.employeeId) } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        bankAccountCiphertext: true,
        bankIfsc: true,
        bankName: true,
      },
    });
    const employeesById = new Map(employees.map((e) => [e.id, e]));

    const rows: BankFileRow[] = [];
    let skipped = 0;
    for (const item of lineItems) {
      const emp = employeesById.get(item.employeeId);
      if (!emp?.bankAccountCiphertext || !emp.bankIfsc) {
        skipped += 1;
        continue;
      }
      rows.push({
        employeeId: item.employeeId,
        employeeName: `${emp.firstName} ${emp.lastName}`,
        employeeCode: emp.employeeCode,
        accountNumber: this.fieldEncryption.decrypt(emp.bankAccountCiphertext),
        ifsc: emp.bankIfsc,
        bankName: emp.bankName,
        amount: item.netPay.toNumber(),
      });
    }

    await writePayrollAudit(
      this.tenantPrisma,
      user,
      'payroll.bank_file_generated',
      'payroll_run',
      runId,
      {
        format,
        rowCount: rows.length,
        skippedCount: skipped,
      },
    );

    return {
      filename: generator.filename(run.period),
      mimeType: generator.mimeType,
      content: generator.generate(rows),
      skippedEmployeeCount: skipped,
    };
  }

  async disburse(runId: string, user: AuthenticatedUser) {
    this.assertCanManage(user);
    const run = await this.getRunOrThrow(runId);
    if (run.status !== 'PROCESSED') {
      throw new ConflictException('Only a PROCESSED run can be disbursed');
    }

    await this.tenantPrisma.client.payrollRun.update({
      where: { id: runId },
      data: { status: 'DISBURSED', disbursedAt: new Date() },
    });
    await writePayrollAudit(
      this.tenantPrisma,
      user,
      'payroll.run_disbursed',
      'payroll_run',
      runId,
      {},
    );
    await this.notifyStatusChange(run, 'DISBURSED', user.sub);
    return this.getRun(runId, user);
  }

  private async getRunOrThrow(runId: string) {
    const run = await this.tenantPrisma.client.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    return run;
  }

  /**
   * Auditor gets the run's status/approval trail/totals only — no
   * per-employee compensation drill-down (module 07 §12 decision 9).
   */
  async getRun(runId: string, user: AuthenticatedUser) {
    const run = await this.tenantPrisma.client.payrollRun.findUnique({
      where: { id: runId },
      include: { approvals: true, lineItems: true },
    });
    if (!run) throw new NotFoundException('Payroll run not found');

    if (user.role === 'AUDITOR') {
      return {
        id: run.id,
        period: run.period,
        status: run.status,
        isReprocess: run.isReprocess,
        reprocessReason: run.reprocessReason,
        processedAt: run.processedAt,
        disbursedAt: run.disbursedAt,
        approvals: run.approvals.map((a) => ({
          approverId: a.approverId,
          approvedAt: a.approvedAt,
        })),
        lineItemCount: run.lineItems.length,
        exceptionCount: Array.isArray(run.exceptions) ? run.exceptions.length : 0,
      };
    }
    if (!MANAGE_ROLES.includes(user.role)) {
      throw new ForbiddenException('Not authorized to view payroll runs');
    }
    return run;
  }
}
