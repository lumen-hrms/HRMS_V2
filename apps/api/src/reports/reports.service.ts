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

export const REPORT_KINDS = ['headcount', 'movement', 'attrition'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export interface ReportQuery {
  from?: string;
  to?: string;
  asOf?: string;
}

/**
 * Org-wide operational reports (module 11). Every figure is computed here on
 * the server from tenant-scoped rows — RLS + the tenant client guarantee the
 * query only sees this tenant's employees. Headcount, joiners/leavers and
 * attrition carry no compensation data, so the controller's role gate is the
 * only access rule they need. Payroll-cost and statutory registers are not
 * here: they depend on the unbuilt Payroll module (docs/modules/11 §1.1).
 */
@Injectable()
export class ReportsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async run(kind: string, query: ReportQuery) {
    this.assertKind(kind);
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
