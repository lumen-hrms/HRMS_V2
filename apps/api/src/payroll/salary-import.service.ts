import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import {
  buildReport,
  IMPORT_CONCURRENCY,
  type ImportReport,
  type ImportRowResult,
  normalizeHeader,
  type OnImportProgress,
  parseImportDate,
  readSpreadsheet,
  type SheetRow,
} from '../common/bulk-import';
import { mapWithConcurrency } from '../common/concurrency.util';
import { PayrollConfigService } from './payroll-config.service';
import { SalaryStructureService } from './salary-structure.service';
import { normalizeAndValidateComponents } from './salary-structure.validation';
import { resolveMonthlyAmounts } from './salary-components.util';
import type { SalaryComponentDto } from './dto/payroll.dto';

/**
 * Salary import columns. One row = one employee's structure on the standard
 * template (the same shape as the structure editor's quick-start): Basic as
 * a % of CTC, HRA as a % of Basic, optional fixed monthly DA / Conveyance /
 * Medical / LTA, and Special Allowance as the balancing figure. Anything
 * more bespoke (CUSTOM components, formulas) stays in the editor.
 */
export const SALARY_IMPORT_COLUMNS = [
  'employeeCode',
  'ctcAnnual',
  'effectiveFrom',
  'basicPercentOfCtc',
  'hraPercentOfBasic',
  'daMonthly',
  'conveyanceMonthly',
  'medicalMonthly',
  'ltaMonthly',
  'reason',
] as const;

type Column = (typeof SALARY_IMPORT_COLUMNS)[number];
const KNOWN_HEADERS = new Set(SALARY_IMPORT_COLUMNS.map((c) => normalizeHeader(c)));

const DEFAULT_BASIC_PERCENT = 50;
const DEFAULT_HRA_PERCENT = 40;

const FIXED_COLUMNS: { column: Column; type: SalaryComponentDto['type']; name: string }[] = [
  { column: 'daMonthly', type: 'DA', name: 'Dearness Allowance' },
  { column: 'conveyanceMonthly', type: 'CONVEYANCE', name: 'Conveyance' },
  { column: 'medicalMonthly', type: 'MEDICAL', name: 'Medical' },
  { column: 'ltaMonthly', type: 'LTA', name: 'LTA' },
];

interface PlannedSalary {
  row: number;
  code: string | null;
  employeeId: string | null;
  action: 'create' | 'update' | null;
  ctcAnnual: number;
  effectiveFrom: string;
  components: SalaryComponentDto[];
  reason?: string;
  detail?: string;
  errors: string[];
}

const inr = (n: { toFixed(d: number): string }) =>
  `₹${Number(n.toFixed(0)).toLocaleString('en-IN')}`;

/**
 * Payroll bulk salary import (module 07). Every row is validated with the
 * exact rules the structure editor uses (`normalizeAndValidateComponents`
 * — Basic floor, percentages, formula), then written through
 * `SalaryStructureService.create()` for an employee with no structure yet,
 * or `.update()` for one that has one — so a revision that reaches into an
 * already-processed period still auto-upgrades to a revision with arrears,
 * exactly as it would from the editor. `dryRun` writes nothing and returns
 * each row's monthly breakdown.
 */
@Injectable()
export class SalaryImportService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly config: PayrollConfigService,
    private readonly structures: SalaryStructureService,
  ) {}

  async import(
    buffer: Buffer | undefined,
    actor: AuthenticatedUser,
    dryRun: boolean,
    onProgress?: OnImportProgress,
  ): Promise<ImportReport> {
    const sheet = await readSpreadsheet(buffer);
    const ignoredColumns = sheet.headers.filter((h) => !KNOWN_HEADERS.has(h));
    for (const required of ['employeeCode', 'ctcAnnual'] as const) {
      if (!sheet.headers.includes(normalizeHeader(required))) {
        throw new BadRequestException(`Missing required column: ${required}`);
      }
    }

    const client = this.tenantPrisma.client;
    const [employees, activeStructures, settings] = await Promise.all([
      client.employee.findMany({
        select: { id: true, employeeCode: true, lifecycleState: true, dateOfJoining: true },
      }),
      client.salaryStructure.findMany({
        where: { status: 'ACTIVE' },
        select: { employeeId: true },
      }),
      this.config.getSettings(),
    ]);
    const employeeByCode = new Map(employees.map((e) => [e.employeeCode, e]));
    const hasStructure = new Set(activeStructures.map((s) => s.employeeId));

    const planned = sheet.rows.map((r) =>
      this.parseRow(r, employeeByCode, hasStructure, settings.minBasicPercent),
    );
    const seen = new Map<string, number>();
    for (const p of planned) {
      if (!p.code) continue;
      const first = seen.get(p.code);
      if (first !== undefined)
        p.errors.push(`employeeCode ${p.code} already appears on row ${first}`);
      else seen.set(p.code, p.row);
    }

    if (dryRun) {
      const ok = planned.filter((p) => p.errors.length === 0);
      return buildReport(
        true,
        planned.map((p) => this.toResult(p, p.errors.length === 0)),
        ignoredColumns,
        {
          create: ok.filter((p) => p.action === 'create').length,
          update: ok.filter((p) => p.action === 'update').length,
        },
      );
    }

    const done = new Set<PlannedSalary>();
    const valid = planned.filter((p) => p.errors.length === 0);
    let saved = 0;
    onProgress?.({ phase: 'saving', done: 0, total: valid.length });
    await mapWithConcurrency(valid, IMPORT_CONCURRENCY, async (p) => {
      const dto = {
        ctcAnnual: p.ctcAnnual,
        effectiveFrom: p.effectiveFrom,
        components: p.components,
        reason: p.reason,
      };
      try {
        if (p.action === 'create') await this.structures.create(p.employeeId!, dto, actor);
        else await this.structures.update(p.employeeId!, dto, actor);
        done.add(p);
      } catch (e: any) {
        p.errors.push(e?.response?.message ?? e?.message ?? 'Unknown error');
      }
      onProgress?.({ phase: 'saving', done: ++saved, total: valid.length });
    });

    const ok = planned.filter((p) => done.has(p));
    return buildReport(
      false,
      planned.map((p) => this.toResult(p, done.has(p))),
      ignoredColumns,
      {
        created: ok.filter((p) => p.action === 'create').length,
        updated: ok.filter((p) => p.action === 'update').length,
      },
    );
  }

  private parseRow(
    sheetRow: SheetRow,
    employeeByCode: Map<string, { id: string; lifecycleState: string; dateOfJoining: Date | null }>,
    hasStructure: Set<string>,
    minBasicPercent: Parameters<typeof normalizeAndValidateComponents>[2],
  ): PlannedSalary {
    const get = (c: Column) => sheetRow.values.get(normalizeHeader(c));
    const p: PlannedSalary = {
      row: sheetRow.row,
      code: get('employeeCode') ?? null,
      employeeId: null,
      action: null,
      ctcAnnual: 0,
      effectiveFrom: '',
      components: [],
      errors: [],
    };
    const err = (msg: string) => p.errors.push(msg);

    if (!p.code) {
      err('employeeCode is required');
      return p;
    }
    const employee = employeeByCode.get(p.code);
    if (!employee) {
      err(`No employee with code ${p.code} — import them under Employees first`);
      return p;
    }
    if (employee.lifecycleState === 'SEPARATED') {
      err('This employee is separated — use Full & Final instead');
      return p;
    }
    p.employeeId = employee.id;
    p.action = hasStructure.has(employee.id) ? 'update' : 'create';

    const number = (c: Column, opts: { min?: number; max?: number } = {}) => {
      const raw = get(c);
      if (raw === undefined) return undefined;
      const n = Number(raw.replace(/[,₹\s]/g, ''));
      if (!Number.isFinite(n)) {
        err(`${c} "${raw}" is not a number`);
        return undefined;
      }
      if (opts.min !== undefined && n < opts.min) err(`${c} must be at least ${opts.min}`);
      if (opts.max !== undefined && n > opts.max) err(`${c} must be at most ${opts.max}`);
      return Math.round(n * 100) / 100;
    };

    const ctc = number('ctcAnnual');
    if (ctc === undefined) err('ctcAnnual is required');
    else if (ctc <= 0) err('ctcAnnual must be more than 0');
    else p.ctcAnnual = ctc;

    const rawDate = get('effectiveFrom');
    if (rawDate) {
      const iso = parseImportDate(rawDate);
      if (iso) p.effectiveFrom = iso;
      else err(`effectiveFrom "${rawDate}" is not a date — use YYYY-MM-DD or DD-MM-YYYY`);
    } else if (employee.dateOfJoining) {
      p.effectiveFrom = employee.dateOfJoining.toISOString().slice(0, 10);
    } else {
      err('effectiveFrom is required (the employee has no date of joining to default to)');
    }

    const basicPct = number('basicPercentOfCtc', { min: 0, max: 100 }) ?? DEFAULT_BASIC_PERCENT;
    const hraPct = number('hraPercentOfBasic', { min: 0, max: 100 }) ?? DEFAULT_HRA_PERCENT;

    const reason = get('reason');
    if (reason !== undefined && reason.length < 10) {
      err('reason must be at least 10 characters');
    } else {
      p.reason = reason;
    }

    if (p.errors.length > 0) return p;

    const components: SalaryComponentDto[] = [
      { type: 'BASIC', name: 'Basic', calculationMode: 'PERCENT_OF_CTC', value: basicPct },
    ];
    if (hraPct > 0) {
      components.push({
        type: 'HRA',
        name: 'HRA',
        calculationMode: 'PERCENT_OF_BASIC',
        value: hraPct,
      });
    }
    for (const { column, type, name } of FIXED_COLUMNS) {
      const amount = number(column, { min: 0 });
      if (amount) components.push({ type, name, calculationMode: 'FIXED', value: amount });
    }
    const others = components.map((c) => c.type).join(' - ');
    components.push({
      type: 'SPECIAL_ALLOWANCE',
      name: 'Special Allowance',
      calculationMode: 'FORMULA',
      formula: `CTC - ${others}`,
    });
    components.forEach((c, i) => (c.sortOrder = i));
    if (p.errors.length > 0) return p;

    try {
      const normalized = normalizeAndValidateComponents(components, p.ctcAnnual, minBasicPercent);
      const amounts = resolveMonthlyAmounts(normalized, p.ctcAnnual);
      const special = amounts.get('SPECIAL_ALLOWANCE')!;
      if (special.isNegative()) {
        err(
          `The components add up to more than the monthly CTC (${inr(
            special.negated(),
          )} over) — lower Basic/HRA or the fixed allowances`,
        );
        return p;
      }
      p.components = components;
      p.detail = [
        `Monthly CTC ${inr(p.ctcAnnual / 12)}`,
        ...normalized.map((c) => `${c.name} ${inr(amounts.get(c.code)!)}`),
      ].join(' · ');
    } catch (e: any) {
      err(e?.response?.message ?? e?.message ?? 'Invalid salary structure');
    }
    return p;
  }

  private toResult(p: PlannedSalary, success: boolean): ImportRowResult {
    return {
      row: p.row,
      employeeCode: p.code,
      action: p.action,
      success,
      ...(p.errors.length > 0 ? { error: p.errors.join('; ') } : {}),
      ...(p.detail ? { detail: p.detail } : {}),
    };
  }
}
