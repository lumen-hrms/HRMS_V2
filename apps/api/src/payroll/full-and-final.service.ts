import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import { LeaveService } from '../leave/leave.service';
import { PayrollConfigService } from './payroll-config.service';
import { writePayrollAudit } from './payroll-audit';
import { calculatePayroll, PayrollCalculationError } from './payroll-calculator';
import { computePayableDays, effectiveWeeklyOffDays, monthRange } from './working-days.util';
import { BASIC_CODE, resolveMonthlyAmounts } from './salary-components.util';
import {
  calculateGratuity,
  calculateLeaveEncashment,
  completedYearsOfService,
} from './full-and-final-calculator';
import type { GenerateFnfDto, UpdateFnfAdvanceDto } from './dto/payroll.dto';

const MANAGE_ROLES = ['COMPANY_ADMIN', 'HR_MANAGER'];

@Injectable()
export class FullAndFinalService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly config: PayrollConfigService,
    private readonly attendance: AttendanceService,
    private readonly leave: LeaveService,
  ) {}

  /** INV-4: same payroll gate as regular runs — real money either way. */
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
      throw new ForbiddenException('Not authorized to manage Full & Final settlements');
    }
  }

  /** HR/Admin and Auditor can read anyone's (Auditor gets a reduced view); an Employee only their own. */
  private assertCanRead(user: AuthenticatedUser, employeeId: string) {
    if (MANAGE_ROLES.includes(user.role) || user.role === 'AUDITOR') return;
    if (user.role === 'EMPLOYEE' && user.employeeId === employeeId) return;
    throw new ForbiddenException('Not authorized to view this settlement');
  }

  private async getOrThrow(employeeId: string) {
    const row = await this.tenantPrisma.client.fullAndFinalSettlement.findUnique({
      where: { employeeId },
    });
    if (!row) throw new NotFoundException('No Full & Final settlement for this employee');
    return row;
  }

  /**
   * Computes and stores a DRAFT settlement for a `SEPARATED` employee
   * (module 07 §9 Phase 8). Standalone off-cycle record — never folded
   * into a `PayrollRun` (decision 7). At most one per employee ever.
   */
  async generate(employeeId: string, dto: GenerateFnfDto, user: AuthenticatedUser) {
    this.assertCanManage(user);
    await this.assertPayrollGate();

    if (
      await this.tenantPrisma.client.fullAndFinalSettlement.findUnique({ where: { employeeId } })
    ) {
      throw new ConflictException('A Full & Final settlement already exists for this employee');
    }

    const employee = await this.tenantPrisma.client.employee.findUnique({
      where: { id: employeeId },
      include: {
        salaryStructures: { where: { status: 'ACTIVE' }, include: { components: true } },
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.lifecycleState !== 'SEPARATED') {
      throw new ConflictException('Full & Final can only be generated for a SEPARATED employee');
    }
    if (!employee.lastWorkingDate) {
      throw new ConflictException('This employee has no lastWorkingDate on file');
    }
    if (!employee.dateOfJoining) {
      throw new BadRequestException(
        'This employee has no dateOfJoining on file — gratuity cannot be computed',
      );
    }
    const structure = employee.salaryStructures[0];
    if (!structure) {
      throw new ConflictException('This employee has no active salary structure');
    }

    const separationDate = employee.lastWorkingDate;
    const period = separationDate.toISOString().slice(0, 7); // YYYY-MM
    const { start, end } = monthRange(period);
    const month = Number(period.split('-')[1]);

    const [settings, tenantSettings, ptSlabs, lopDays, encashableDays, holidays] =
      await Promise.all([
        this.config.getSettings(),
        this.tenantPrisma.client.tenantSettings.findUniqueOrThrow({
          where: { tenantId: this.tenantPrisma.tenantId },
        }),
        employee.workState
          ? this.tenantPrisma.client.professionalTaxSlab.findMany({
              where: { state: employee.workState },
              orderBy: { grossFrom: 'asc' },
            })
          : Promise.resolve([]),
        this.attendance.getLopDays(employeeId, period),
        this.leave.getEncashableBalance(employeeId, separationDate),
        this.tenantPrisma.client.holiday.findMany({
          where: { date: { gte: start, lt: end } },
          select: { date: true },
        }),
      ]);

    const holidayDates = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
    const weeklyOffDays = effectiveWeeklyOffDays(
      tenantSettings.weeklyOffDays,
      employee.weeklyOffDaysOverride,
    );
    const { workingDays, payableDays } = computePayableDays(
      start,
      new Date(end.getTime() - 1),
      holidayDates,
      weeklyOffDays,
      lopDays,
      undefined,
      separationDate,
    );

    let unpaid;
    try {
      unpaid = calculatePayroll({
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
        ptSlabs,
        month,
        allowNegativeNet: true,
      });
    } catch (e) {
      if (e instanceof PayrollCalculationError) throw new ConflictException(e.message);
      throw e;
    }

    const monthlyAmounts = resolveMonthlyAmounts(structure.components, structure.ctcAnnual);
    const lastDrawnBasic = monthlyAmounts.get(BASIC_CODE) ?? new Prisma.Decimal(0);
    const completedYears = completedYearsOfService(employee.dateOfJoining, separationDate);
    const gratuityAmount = calculateGratuity({
      lastDrawnBasic,
      completedYears,
      eligibilityYears: settings.gratuityEligibilityYears,
      daysPerYear: settings.gratuityDaysPerYear,
      monthDivisor: settings.gratuityMonthDivisor,
    });

    const componentsMonthlyTotal = settings.leaveEncashmentComponents.reduce(
      (sum: Prisma.Decimal, code: string) =>
        sum.plus(monthlyAmounts.get(code) ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0),
    );
    const leaveEncashmentAmount = calculateLeaveEncashment({
      encashableDays,
      componentsMonthlyTotal,
      divisor: settings.leaveEncashmentDivisor,
    });

    const advanceRecoveryAmount = new Prisma.Decimal(dto.advanceRecoveryAmount ?? 0);
    const netSettlement = unpaid.netPay
      .plus(leaveEncashmentAmount)
      .plus(gratuityAmount)
      .minus(advanceRecoveryAmount);

    const id = randomUUID();
    await this.tenantPrisma.client.fullAndFinalSettlement.create({
      data: {
        id,
        tenantId: this.tenantPrisma.tenantId,
        employeeId,
        separationDate,
        unpaidSalaryDays: payableDays,
        unpaidSalaryAmount: unpaid.netPay,
        leaveEncashmentDays: encashableDays,
        leaveEncashmentAmount,
        gratuityYearsOfService: completedYears,
        gratuityAmount,
        advanceRecoveryAmount,
        netSettlement,
        calculationSnapshot: {
          workingDays,
          payableDays,
          grossEarnings: unpaid.grossEarnings.toNumber(),
          epfEmployee: unpaid.epf.employeeContribution.toNumber(),
          esiEmployee: unpaid.esi.employeeContribution.toNumber(),
          professionalTax: unpaid.professionalTax.toNumber(),
          lastDrawnBasic: lastDrawnBasic.toNumber(),
        } as unknown as Prisma.InputJsonValue,
        status: 'DRAFT',
        preparedBy: user.sub,
      },
    });

    await writePayrollAudit(
      this.tenantPrisma,
      user,
      'payroll.fnf_generated',
      'employee',
      employeeId,
      {
        separationDate: separationDate.toISOString().slice(0, 10),
        unpaidSalaryDays: payableDays,
        gratuityYearsOfService: completedYears,
      },
    );

    return this.get(employeeId, user);
  }

  async get(employeeId: string, user: AuthenticatedUser) {
    this.assertCanRead(user, employeeId);
    const row = await this.getOrThrow(employeeId);
    if (user.role === 'AUDITOR') {
      // Decision 9: run summaries/approval trail only, no per-employee
      // compensation drill-down — same reduced view as getRun().
      return {
        employeeId: row.employeeId,
        separationDate: row.separationDate,
        status: row.status,
        approvedAt: row.approvedAt,
        paidAt: row.paidAt,
      };
    }
    return row;
  }

  /** DRAFT only — recomputes netSettlement from the revised advance recovery figure. */
  async updateAdvance(employeeId: string, dto: UpdateFnfAdvanceDto, user: AuthenticatedUser) {
    this.assertCanManage(user);
    const row = await this.getOrThrow(employeeId);
    if (row.status !== 'DRAFT') {
      throw new ConflictException('Only a DRAFT settlement can be adjusted');
    }
    const advanceRecoveryAmount = new Prisma.Decimal(dto.advanceRecoveryAmount);
    const netSettlement = row.unpaidSalaryAmount
      .plus(row.leaveEncashmentAmount)
      .plus(row.gratuityAmount)
      .minus(advanceRecoveryAmount);

    const updated = await this.tenantPrisma.client.fullAndFinalSettlement.update({
      where: { employeeId },
      data: { advanceRecoveryAmount, netSettlement },
    });
    await writePayrollAudit(
      this.tenantPrisma,
      user,
      'payroll.fnf_adjusted',
      'employee',
      employeeId,
      {},
    );
    return updated;
  }

  /** DRAFT -> APPROVED. One approval (decision 7's own approval, distinct from INV-1's two-person rule). */
  async approve(employeeId: string, user: AuthenticatedUser) {
    this.assertCanManage(user);
    await this.assertPayrollGate();
    const row = await this.getOrThrow(employeeId);
    if (row.status !== 'DRAFT') {
      throw new ConflictException('Only a DRAFT settlement can be approved');
    }
    const updated = await this.tenantPrisma.client.fullAndFinalSettlement.update({
      where: { employeeId },
      data: { status: 'APPROVED', approvedBy: user.sub, approvedAt: new Date() },
    });
    await writePayrollAudit(
      this.tenantPrisma,
      user,
      'payroll.fnf_approved',
      'employee',
      employeeId,
      {},
    );
    return updated;
  }

  /** APPROVED -> PAID. */
  async markPaid(employeeId: string, user: AuthenticatedUser) {
    this.assertCanManage(user);
    const row = await this.getOrThrow(employeeId);
    if (row.status !== 'APPROVED') {
      throw new ConflictException('Only an APPROVED settlement can be marked paid');
    }
    const updated = await this.tenantPrisma.client.fullAndFinalSettlement.update({
      where: { employeeId },
      data: { status: 'PAID', paidAt: new Date() },
    });
    await writePayrollAudit(
      this.tenantPrisma,
      user,
      'payroll.fnf_paid',
      'employee',
      employeeId,
      {},
    );
    return updated;
  }
}
