import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IndianState, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { writePayrollAudit } from './payroll-audit';
import type { LineItemQueryDto } from './dto/payroll.dto';

/**
 * Read models for the payroll screens (overview, run review, people & pay).
 * Nothing here changes payroll state except `bulkSetWorkState`; the run
 * lifecycle and its invariants stay in PayrollRunService.
 */

const D = (v: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(v ?? 0);
const money = (v: Prisma.Decimal) => v.toFixed(2);
const MAX_LISTED = 50;
const INACTIVE = ['SEPARATED', 'PRE_JOINING'] as const;

export function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;

@Injectable()
export class PayrollInsightsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  /** Latest settled run of the month before `period`, used for month-on-month comparison. */
  private previousRun(period: string) {
    return this.db.payrollRun.findFirst({
      where: { period: previousPeriod(period), status: { in: ['PROCESSED', 'DISBURSED'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, period: true },
    });
  }

  private async getRunRow(runId: string) {
    const run = await this.db.payrollRun.findUnique({
      where: { id: runId },
      include: { approvals: true },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    return run;
  }

  async getRunSummary(runId: string) {
    const run = await this.getRunRow(runId);
    const prev = await this.previousRun(run.period);
    const prevItems = prev
      ? await this.db.payrollLineItem.findMany({
          where: { runId: prev.id },
          select: { grossEarnings: true, epfEmployer: true, esiEmployer: true, netPay: true },
        })
      : [];
    const [items, approverUsers] = await Promise.all([
      this.db.payrollLineItem.findMany({
        where: { runId },
        select: {
          employeeId: true,
          grossEarnings: true,
          epfEmployee: true,
          epfEmployer: true,
          esiEmployee: true,
          esiEmployer: true,
          professionalTax: true,
          tdsDeducted: true,
          netPay: true,
          adHocAdjustments: true,
        },
      }),
      this.db.user.findMany({
        where: { id: { in: [...run.approvals.map((a) => a.approverId), run.preparedBy] } },
        select: {
          id: true,
          email: true,
          employee: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);
    const userName = (id: string) => {
      const u = approverUsers.find((x) => x.id === id);
      return u ? (u.employee ? fullName(u.employee) : u.email) : null;
    };

    const sum = (pick: (i: (typeof items)[number]) => Prisma.Decimal) =>
      items.reduce((s, i) => s.plus(pick(i)), D(0));
    const gross = sum((i) => i.grossEarnings);
    const net = sum((i) => i.netPay);
    const epfEmployer = sum((i) => i.epfEmployer);
    const esiEmployer = sum((i) => i.esiEmployer);
    const epfEmployee = sum((i) => i.epfEmployee);
    const esiEmployee = sum((i) => i.esiEmployee);
    const pt = sum((i) => i.professionalTax);
    const tds = sum((i) => i.tdsDeducted);

    const employees = await this.db.employee.findMany({
      where: { id: { in: items.map((i) => i.employeeId) } },
      select: { id: true, department: { select: { name: true } } },
    });
    const deptOf = new Map(employees.map((e) => [e.id, e.department?.name ?? 'No department']));
    const byDept = new Map<string, { headcount: number; net: Prisma.Decimal }>();
    for (const i of items) {
      const k = deptOf.get(i.employeeId) ?? 'No department';
      const cur = byDept.get(k) ?? { headcount: 0, net: D(0) };
      byDept.set(k, { headcount: cur.headcount + 1, net: cur.net.plus(i.netPay) });
    }

    const exceptions = Array.isArray(run.exceptions) ? run.exceptions : [];
    const prevGross = prevItems.reduce((s, i) => s.plus(i.grossEarnings), D(0));
    const prevNet = prevItems.reduce((s, i) => s.plus(i.netPay), D(0));
    const prevEmployer = prevItems.reduce(
      (s, i) => s.plus(i.grossEarnings).plus(i.epfEmployer).plus(i.esiEmployer),
      D(0),
    );

    return {
      run: {
        id: run.id,
        period: run.period,
        status: run.status,
        isReprocess: run.isReprocess,
        reprocessReason: run.reprocessReason,
        preparedBy: run.preparedBy,
        preparedByName: userName(run.preparedBy),
        exceptions,
        createdAt: run.createdAt,
        processedAt: run.processedAt,
        disbursedAt: run.disbursedAt,
      },
      approvals: run.approvals.map((a) => ({
        approverId: a.approverId,
        approverName: userName(a.approverId),
        approvedAt: a.approvedAt,
      })),
      totals: {
        headcount: items.length,
        gross: money(gross),
        net: money(net),
        deductions: money(epfEmployee.plus(esiEmployee).plus(pt).plus(tds)),
        employerCost: money(gross.plus(epfEmployer).plus(esiEmployer)),
        epfEmployee: money(epfEmployee),
        esiEmployee: money(esiEmployee),
        professionalTax: money(pt),
        tds: money(tds),
        employerContributions: money(epfEmployer.plus(esiEmployer)),
        adjustedCount: items.filter(
          (i) => Array.isArray(i.adHocAdjustments) && i.adHocAdjustments.length > 0,
        ).length,
      },
      previous: prev
        ? {
            period: prev.period,
            headcount: prevItems.length,
            gross: money(prevGross),
            net: money(prevNet),
            employerCost: money(prevEmployer),
          }
        : null,
      departments: [...byDept.entries()]
        .map(([name, v]) => ({ name, headcount: v.headcount, net: money(v.net) }))
        .sort((a, b) => Number(b.net) - Number(a.net)),
    };
  }

  /** Paginated, searchable line items with month-on-month change. Never includes the calculation snapshot. */
  async listLineItems(runId: string, q: LineItemQueryDto) {
    const run = await this.getRunRow(runId);
    const prev = await this.previousRun(run.period);
    const prevItems = prev
      ? await this.db.payrollLineItem.findMany({
          where: { runId: prev.id },
          select: { employeeId: true, netPay: true },
        })
      : [];
    const items = await this.db.payrollLineItem.findMany({
      where: { runId },
      select: {
        id: true,
        employeeId: true,
        workingDays: true,
        payableDays: true,
        lopDays: true,
        grossEarnings: true,
        epfEmployee: true,
        esiEmployee: true,
        professionalTax: true,
        tdsDeducted: true,
        netPay: true,
        adHocAdjustments: true,
        payslipFileKey: true,
      },
    });
    const employees = await this.db.employee.findMany({
      where: { id: { in: items.map((i) => i.employeeId) } },
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        designation: true,
        department: { select: { name: true } },
      },
    });
    const emp = new Map(employees.map((e) => [e.id, e]));
    const prevNet = new Map(prevItems.map((p) => [p.employeeId, p.netPay]));
    const exceptionsByEmployee = new Map<string, string[]>();
    for (const e of (Array.isArray(run.exceptions) ? run.exceptions : []) as {
      employeeId?: string;
      type: string;
    }[]) {
      if (!e.employeeId) continue;
      exceptionsByEmployee.set(e.employeeId, [
        ...(exceptionsByEmployee.get(e.employeeId) ?? []),
        e.type,
      ]);
    }

    let rows = items.map((i) => {
      const e = emp.get(i.employeeId);
      const before = prevNet.get(i.employeeId);
      const changePct =
        before && !before.isZero()
          ? Number(i.netPay.minus(before).div(before).times(100).toFixed(1))
          : null;
      const adjustments = Array.isArray(i.adHocAdjustments) ? i.adHocAdjustments : [];
      return {
        id: i.id,
        employeeId: i.employeeId,
        employee: e
          ? {
              name: fullName(e),
              employeeCode: e.employeeCode,
              designation: e.designation,
              department: e.department?.name ?? null,
            }
          : null,
        workingDays: i.workingDays,
        payableDays: i.payableDays,
        lopDays: i.lopDays,
        grossEarnings: money(i.grossEarnings),
        epfEmployee: money(i.epfEmployee),
        esiEmployee: money(i.esiEmployee),
        professionalTax: money(i.professionalTax),
        tdsDeducted: money(i.tdsDeducted),
        netPay: money(i.netPay),
        hasAdjustments: adjustments.length > 0,
        exceptionTypes: exceptionsByEmployee.get(i.employeeId) ?? [],
        previousNet: before ? money(before) : null,
        changePct,
        payslipReady: !!i.payslipFileKey,
      };
    });

    const search = q.search?.trim().toLowerCase();
    if (search) {
      rows = rows.filter(
        (r) =>
          r.employee?.name.toLowerCase().includes(search) ||
          r.employee?.employeeCode.toLowerCase().includes(search),
      );
    }
    if (q.department)
      rows = rows.filter((r) => (r.employee?.department ?? 'No department') === q.department);
    if (q.hasException) rows = rows.filter((r) => r.exceptionTypes.length > 0);
    if (q.adjustedOnly) rows = rows.filter((r) => r.hasAdjustments);
    if (q.changedOver !== undefined) {
      rows = rows.filter((r) => r.changePct !== null && Math.abs(r.changePct) >= q.changedOver!);
    }

    const dir = q.dir === 'desc' ? -1 : 1;
    const key = q.sort ?? 'name';
    rows.sort((a, b) => {
      if (key === 'net') return (Number(a.netPay) - Number(b.netPay)) * dir;
      if (key === 'gross') return (Number(a.grossEarnings) - Number(b.grossEarnings)) * dir;
      if (key === 'change') return ((a.changePct ?? -Infinity) - (b.changePct ?? -Infinity)) * dir;
      return (a.employee?.name ?? '').localeCompare(b.employee?.name ?? '') * dir;
    });

    const pageSize = q.pageSize ?? 25;
    const page = Math.max(1, q.page ?? 1);
    return {
      total: rows.length,
      page,
      pageSize,
      filteredNet: money(rows.reduce((s, r) => s.plus(r.netPay), D(0))),
      departments: [...new Set(employees.map((e) => e.department?.name ?? 'No department'))].sort(),
      items: rows.slice((page - 1) * pageSize, page * pageSize),
    };
  }

  /** One employee's full breakdown for the review drawer (includes the stored calculation snapshot). */
  async getLineItemDetail(runId: string, employeeId: string) {
    const run = await this.getRunRow(runId);
    const item = await this.db.payrollLineItem.findUnique({
      where: { runId_employeeId: { runId, employeeId } },
    });
    if (!item) throw new NotFoundException('No line item for this employee in the run');
    const [e, prev] = await Promise.all([
      this.db.employee.findUnique({
        where: { id: employeeId },
        select: {
          employeeCode: true,
          firstName: true,
          lastName: true,
          designation: true,
          department: { select: { name: true } },
        },
      }),
      this.previousRun(run.period).then((p) =>
        p
          ? this.db.payrollLineItem.findUnique({
              where: { runId_employeeId: { runId: p.id, employeeId } },
              select: { netPay: true },
            })
          : null,
      ),
    ]);
    const exceptions = (Array.isArray(run.exceptions) ? run.exceptions : []).filter(
      (x) => (x as { employeeId?: string }).employeeId === employeeId,
    );
    return {
      ...item,
      employee: e
        ? {
            name: fullName(e),
            employeeCode: e.employeeCode,
            designation: e.designation,
            department: e.department?.name ?? null,
          }
        : null,
      previousNet: prev ? money(prev.netPay) : null,
      exceptions,
    };
  }

  /**
   * What would stop or degrade a run for `period`. Blockers leave an employee
   * out of the run (the calculator reports them as exceptions); warnings don't.
   */
  async getReadiness(period: string) {
    const [employees, pendingRegularizations, existing] = await Promise.all([
      this.db.employee.findMany({
        where: { lifecycleState: { notIn: [...INACTIVE] } },
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          workState: true,
          dateOfBirth: true,
          bankAccountCiphertext: true,
          bankIfsc: true,
          salaryStructures: { where: { status: 'ACTIVE' }, select: { id: true }, take: 1 },
        },
      }),
      this.db.regularizationRequest.count({
        where: {
          status: 'PENDING',
          targetDate: {
            gte: new Date(`${period}-01T00:00:00Z`),
            lt: new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 1)),
          },
        },
      }),
      this.db.payrollRun.findFirst({
        where: { period },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true },
      }),
    ]);
    const group = (
      type: string,
      label: string,
      help: string,
      pick: (e: (typeof employees)[number]) => boolean,
    ) => {
      const hit = employees.filter(pick);
      return {
        type,
        label,
        help,
        count: hit.length,
        employees: hit.slice(0, MAX_LISTED).map((e) => ({
          id: e.id,
          name: fullName(e),
          employeeCode: e.employeeCode,
        })),
      };
    };
    const blockers = [
      group(
        'NO_WORK_STATE',
        'No work state',
        'Professional Tax can’t be worked out — left out of the run.',
        (e) => !e.workState,
      ),
      group(
        'NO_SALARY_STRUCTURE',
        'No salary structure',
        'Nothing to pay from — left out of the run.',
        (e) => e.salaryStructures.length === 0,
      ),
    ].filter((g) => g.count > 0);
    const warnings = [
      group(
        'NO_DOB',
        'No date of birth',
        'Payslips are password-locked with the date of birth, so no payslip is generated.',
        (e) => !e.dateOfBirth,
      ),
      group(
        'NO_BANK',
        'No bank details',
        'Skipped from the bank file.',
        (e) => !e.bankAccountCiphertext || !e.bankIfsc,
      ),
    ].filter((g) => g.count > 0);
    return {
      period,
      eligibleCount: employees.length,
      blockers,
      warnings,
      pendingRegularizations,
      existingRun: existing,
    };
  }

  /** Employee-centric payroll view: who has a structure, bank details, a work state. */
  async listPeople() {
    const employees = await this.db.employee.findMany({
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        designation: true,
        lifecycleState: true,
        workState: true,
        dateOfBirth: true,
        bankAccountCiphertext: true,
        bankIfsc: true,
        department: { select: { name: true } },
        salaryStructures: {
          where: { status: 'ACTIVE' },
          select: { ctcAnnual: true, effectiveFrom: true },
          take: 1,
        },
      },
    });
    return employees.map((e) => {
      const s = e.salaryStructures[0];
      return {
        id: e.id,
        name: fullName(e),
        employeeCode: e.employeeCode,
        designation: e.designation,
        department: e.department?.name ?? null,
        lifecycleState: e.lifecycleState,
        workState: e.workState,
        ctcAnnual: s ? money(s.ctcAnnual) : null,
        structureEffectiveFrom: s?.effectiveFrom ?? null,
        hasStructure: !!s,
        hasBank: !!e.bankAccountCiphertext && !!e.bankIfsc,
        hasDob: !!e.dateOfBirth,
      };
    });
  }

  async bulkSetWorkState(employeeIds: string[], workState: IndianState, user: AuthenticatedUser) {
    if (!['COMPANY_ADMIN', 'HR_MANAGER'].includes(user.role)) {
      throw new ForbiddenException('Not authorized to change employees');
    }
    if (!(workState in IndianState)) throw new BadRequestException('Unknown state');
    const result = await this.db.employee.updateMany({
      where: { id: { in: employeeIds } },
      data: { workState },
    });
    await writePayrollAudit(
      this.tenantPrisma,
      user,
      'payroll.bulk_work_state',
      'employee',
      undefined,
      {
        count: result.count,
        workState,
      },
    );
    return { updated: result.count };
  }
}
