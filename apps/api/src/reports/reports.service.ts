import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import {
  computeAttrition,
  computeHeadcount,
  computeMovement,
  EmployeeSnapshot,
  parseIsoDay,
  resolvePeriod,
} from './reports.calculations';
import {
  computeEsiRegister,
  computeGratuityRegister,
  computePayrollCost,
  computePfRegister,
  computeSalaryRegister,
  periodsBetween,
  PayrollLineSnapshot,
} from './payroll-reports.calculations';

export const REPORT_KINDS = [
  'headcount',
  'movement',
  'attrition',
  'payroll-cost',
  'salary-register',
  'pf-register',
  'esi-register',
  'gratuity-register',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export interface ReportQuery {
  from?: string;
  to?: string;
  asOf?: string;
  /** YYYY-MM — the pay period a statutory register is drawn from. */
  period?: string;
}

/**
 * Org-wide operational reports (module 11). Every figure is computed here on
 * the server from tenant-scoped rows — RLS + the tenant client guarantee the
 * query only sees this tenant's employees. Headcount, joiners/leavers and
 * attrition carry no compensation data, so the controller's role gate is the
 * only access rule they need. Payroll-cost and the statutory registers read
 * only PROCESSED/DISBURSED payroll runs (module 07 INV-2: immutable) and
 * reformat Payroll's stored figures — they never recompute a deduction.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async run(kind: string, query: ReportQuery) {
    this.assertKind(kind);
    if (kind.endsWith('-register') || kind === 'payroll-cost') {
      return this.runPayroll(kind, query);
    }
    const employees = await this.loadEmployees();
    if (kind === 'headcount') {
      const asOf = this.parseAsOf(query.asOf);
      return computeHeadcount(employees, asOf);
    }
    const { from, to } = this.period(query);
    return kind === 'movement'
      ? computeMovement(employees, from, to)
      : computeAttrition(employees, from, to);
  }

  private async runPayroll(kind: ReportKind, query: ReportQuery) {
    if (kind === 'gratuity-register') {
      const { from, to } = this.period(query);
      const rows = await this.tenantPrisma.client.fullAndFinalSettlement.findMany({
        where: {
          status: { in: ['APPROVED', 'PAID'] },
          separationDate: { gte: from, lte: to },
        },
        include: {
          employee: {
            select: {
              employeeCode: true,
              firstName: true,
              lastName: true,
              department: { select: { name: true } },
            },
          },
        },
      });
      return computeGratuityRegister(
        rows.map((r) => ({
          employeeCode: r.employee.employeeCode,
          employeeName: `${r.employee.firstName} ${r.employee.lastName}`.trim(),
          departmentName: r.employee.department?.name ?? null,
          separationDate: r.separationDate,
          yearsOfService: r.gratuityYearsOfService,
          amount: r.gratuityAmount,
          status: r.status,
        })),
        from.toISOString().slice(0, 10),
        to.toISOString().slice(0, 10),
      );
    }

    if (kind === 'payroll-cost') {
      const { from, to } = this.period(query);
      const periods = periodsBetween(from, to);
      const lines = await this.loadPayrollLines(periods);
      return computePayrollCost(lines, periods);
    }

    const period = this.parsePeriod(query.period);
    const lines = await this.loadPayrollLines([period]);
    if (kind === 'salary-register') return computeSalaryRegister(lines, period);
    if (kind === 'pf-register') return computePfRegister(lines, period);
    return computeEsiRegister(lines, period);
  }

  private parsePeriod(value: string | undefined): string {
    if (value === undefined) {
      const now = new Date();
      // Default to last month: the current one is rarely processed yet.
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      return d.toISOString().slice(0, 7);
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
      throw new BadRequestException('period must be YYYY-MM');
    }
    return value;
  }

  /**
   * One line per employee per period, taken from the latest PROCESSED/
   * DISBURSED run of that period — a reprocess supersedes the original, and
   * DRAFT/REVIEW/APPROVED runs are never reported (their numbers can still
   * change).
   */
  private async loadPayrollLines(periods: string[]): Promise<PayrollLineSnapshot[]> {
    if (periods.length === 0) return [];
    const runs = await this.tenantPrisma.client.payrollRun.findMany({
      where: { period: { in: periods }, status: { in: ['PROCESSED', 'DISBURSED'] } },
      orderBy: [{ processedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, period: true },
    });
    const latest = new Map<string, string>();
    for (const r of runs) if (!latest.has(r.period)) latest.set(r.period, r.id);
    if (latest.size === 0) return [];
    const periodOf = new Map([...latest.entries()].map(([p, id]) => [id, p]));

    const items = await this.tenantPrisma.client.payrollLineItem.findMany({
      where: { runId: { in: [...latest.values()] } },
      include: {
        employee: {
          select: {
            employeeCode: true,
            firstName: true,
            lastName: true,
            uan: true,
            pfNumber: true,
            esicNumber: true,
            ctcAnnual: true,
            department: { select: { name: true } },
          },
        },
      },
    });
    return items.map((i) => ({
      period: periodOf.get(i.runId)!,
      employeeCode: i.employee.employeeCode,
      employeeName: `${i.employee.firstName} ${i.employee.lastName}`.trim(),
      departmentName: i.employee.department?.name ?? null,
      pfNumber: i.employee.pfNumber,
      uan: i.employee.uan,
      esicNumber: i.employee.esicNumber,
      ctcAnnual: i.employee.ctcAnnual,
      workingDays: i.workingDays,
      payableDays: i.payableDays,
      lopDays: i.lopDays,
      grossEarnings: i.grossEarnings,
      epfEmployee: i.epfEmployee,
      epfEmployer: i.epfEmployer,
      esiEmployee: i.esiEmployee,
      esiEmployer: i.esiEmployer,
      professionalTax: i.professionalTax,
      tdsDeducted: i.tdsDeducted,
      netPay: i.netPay,
      snapshot: i.calculationSnapshot,
    }));
  }

  private assertKind(kind: string): asserts kind is ReportKind {
    if (!(REPORT_KINDS as readonly string[]).includes(kind)) {
      throw new NotFoundException(`Unknown report "${kind}"`);
    }
  }

  private period(query: ReportQuery) {
    try {
      return resolvePeriod(query, new Date());
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'Invalid period');
    }
  }

  private parseAsOf(value: string | undefined): Date {
    const today = new Date();
    if (value === undefined) {
      return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    }
    const day = parseIsoDay(value);
    if (!day) throw new BadRequestException('asOf must be a valid YYYY-MM-DD date');
    return day;
  }

  private async loadEmployees(): Promise<EmployeeSnapshot[]> {
    const rows = await this.tenantPrisma.client.employee.findMany({
      select: {
        employmentType: true,
        dateOfJoining: true,
        lastWorkingDate: true,
        separationReason: true,
        department: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      departmentName: r.department?.name ?? null,
      employmentType: r.employmentType ?? null,
      dateOfJoining: r.dateOfJoining,
      lastWorkingDate: r.lastWorkingDate,
      separationReason: r.separationReason ?? null,
    }));
  }
}
