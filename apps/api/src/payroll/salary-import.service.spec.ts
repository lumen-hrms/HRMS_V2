import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SalaryImportService } from './salary-import.service';
import { PayrollController } from './payroll.controller';
import { EmployeesController } from '../employees/employees.controller';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

const hr: AuthenticatedUser = {
  sub: 'u1',
  tenantId: 't1',
  role: 'HR_MANAGER',
  email: 'hr@x.com',
  employeeId: null,
};

const csv = (...lines: string[]) => Buffer.from(lines.join('\n'), 'utf8');

function buildHarness(
  employees: {
    id: string;
    employeeCode: string;
    lifecycleState?: string;
    dateOfJoining?: Date | null;
  }[] = [{ id: 'emp-1', employeeCode: 'E1' }],
  withStructure: string[] = [],
) {
  const client: any = {
    employee: {
      findMany: jest.fn(async () =>
        employees.map((e) => ({ lifecycleState: 'CONFIRMED', dateOfJoining: null, ...e })),
      ),
    },
    salaryStructure: {
      findMany: jest.fn(async () => withStructure.map((employeeId) => ({ employeeId }))),
    },
  };
  const config = {
    getSettings: jest.fn(async () => ({ minBasicPercent: new Prisma.Decimal(40) })),
  };
  const structures = {
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
  };
  const service = new SalaryImportService(
    { tenantId: 't1', client } as any,
    config as any,
    structures as any,
  );
  return { service, structures };
}

describe('SalaryImportService', () => {
  it('previews each row’s monthly breakdown on a dry run and writes nothing', async () => {
    const { service, structures } = buildHarness();
    const report = await service.import(
      csv('employeeCode,ctcAnnual,effectiveFrom', 'E1,"12,00,000",01-04-2026'),
      hr,
      true,
    );

    expect(report.succeeded).toBe(1);
    expect(report.summary).toEqual({ create: 1, update: 0 });
    // 12L/yr → 1L/mo: Basic 50% = 50,000; HRA 40% of Basic = 20,000; Special = rest.
    expect(report.results[0].detail).toBe(
      'Monthly CTC ₹1,00,000 · Basic ₹50,000 · HRA ₹20,000 · Special Allowance ₹30,000',
    );
    expect(structures.create).not.toHaveBeenCalled();
    expect(structures.update).not.toHaveBeenCalled();
  });

  it('creates a structure on the standard template, with fixed allowances and a balancing Special Allowance', async () => {
    const { service, structures } = buildHarness();
    await service.import(
      csv(
        'employeeCode,ctcAnnual,effectiveFrom,basicPercentOfCtc,hraPercentOfBasic,conveyanceMonthly',
        'E1,600000,2026-04-01,45,50,1600',
      ),
      hr,
      false,
    );

    expect(structures.create).toHaveBeenCalledWith(
      'emp-1',
      {
        ctcAnnual: 600000,
        effectiveFrom: '2026-04-01',
        reason: undefined,
        components: [
          {
            type: 'BASIC',
            name: 'Basic',
            calculationMode: 'PERCENT_OF_CTC',
            value: 45,
            sortOrder: 0,
          },
          {
            type: 'HRA',
            name: 'HRA',
            calculationMode: 'PERCENT_OF_BASIC',
            value: 50,
            sortOrder: 1,
          },
          {
            type: 'CONVEYANCE',
            name: 'Conveyance',
            calculationMode: 'FIXED',
            value: 1600,
            sortOrder: 2,
          },
          {
            type: 'SPECIAL_ALLOWANCE',
            name: 'Special Allowance',
            calculationMode: 'FORMULA',
            formula: 'CTC - BASIC - HRA - CONVEYANCE',
            sortOrder: 3,
          },
        ],
      },
      hr,
    );
  });

  it('goes through update() for an employee who already has a structure', async () => {
    const { service, structures } = buildHarness(undefined, ['emp-1']);
    const report = await service.import(
      csv(
        'employeeCode,ctcAnnual,effectiveFrom,reason',
        'E1,900000,2026-07-01,Annual appraisal 2026',
      ),
      hr,
      false,
    );
    expect(report.summary).toEqual({ created: 0, updated: 1 });
    expect(structures.update).toHaveBeenCalledWith(
      'emp-1',
      expect.objectContaining({ ctcAnnual: 900000, reason: 'Annual appraisal 2026' }),
      hr,
    );
  });

  it('defaults effectiveFrom to the date of joining', async () => {
    const { service, structures } = buildHarness([
      { id: 'emp-1', employeeCode: 'E1', dateOfJoining: new Date('2026-05-15') },
    ]);
    await service.import(csv('employeeCode,ctcAnnual', 'E1,600000'), hr, false);
    expect(structures.create.mock.calls[0][1].effectiveFrom).toBe('2026-05-15');
  });

  it('rejects unknown, separated and duplicate employees, bad numbers and short reasons', async () => {
    const { service } = buildHarness([
      { id: 'emp-1', employeeCode: 'E1' },
      { id: 'emp-2', employeeCode: 'E2', lifecycleState: 'SEPARATED' },
      { id: 'emp-3', employeeCode: 'E3' },
    ]);
    const report = await service.import(
      csv(
        'employeeCode,ctcAnnual,effectiveFrom,reason',
        'NOPE,600000,2026-04-01,',
        'E2,600000,2026-04-01,',
        'E3,lots,2026-04-01,',
        'E1,600000,,short',
        'E1,600000,2026-04-01,',
      ),
      hr,
      true,
    );
    const errors = report.results.map((r) => r.error);
    expect(errors[0]).toMatch(/No employee with code NOPE/);
    expect(errors[1]).toMatch(/separated/);
    expect(errors[2]).toMatch(/ctcAnnual "lots" is not a number/);
    expect(errors[3]).toMatch(/effectiveFrom is required.*reason must be at least 10/);
    expect(errors[4]).toMatch(/already appears on row 5/);
    expect(report.succeeded).toBe(0);
  });

  it('enforces the tenant’s Basic floor and refuses components that overshoot CTC', async () => {
    const { service } = buildHarness([
      { id: 'emp-1', employeeCode: 'E1' },
      { id: 'emp-2', employeeCode: 'E2' },
    ]);
    const report = await service.import(
      csv(
        'employeeCode,ctcAnnual,effectiveFrom,basicPercentOfCtc,hraPercentOfBasic,medicalMonthly',
        'E1,600000,2026-04-01,30,,', // floor is 40%
        'E2,240000,2026-04-01,60,50,5000', // 20k/mo: 12k + 6k + 5k > 20k
      ),
      hr,
      true,
    );
    expect(report.results[0].error).toMatch(/Basic must be at least 40% of CTC/);
    expect(report.results[1].error).toMatch(/add up to more than the monthly CTC \(₹3,000 over\)/);
  });

  it('records a failed write on its row and carries on', async () => {
    const { service, structures } = buildHarness([
      { id: 'emp-1', employeeCode: 'E1' },
      { id: 'emp-2', employeeCode: 'E2' },
    ]);
    structures.create.mockRejectedValueOnce(new BadRequestException('concurrent edit'));
    const report = await service.import(
      csv('employeeCode,ctcAnnual,effectiveFrom', 'E1,600000,2026-04-01', 'E2,600000,2026-04-01'),
      hr,
      false,
    );
    expect(report.results[0]).toMatchObject({ success: false, error: 'concurrent edit' });
    expect(report.results[1].success).toBe(true);
  });

  it('reports saving progress per row', async () => {
    const { service } = buildHarness([
      { id: 'emp-1', employeeCode: 'E1' },
      { id: 'emp-2', employeeCode: 'E2' },
    ]);
    const events: any[] = [];
    await service.import(
      csv('employeeCode,ctcAnnual,effectiveFrom', 'E1,600000,2026-04-01', 'E2,600000,2026-04-01'),
      hr,
      false,
      (p) => events.push(p),
    );
    expect(events.map((e) => e.done)).toEqual([0, 1, 2]);
    expect(events.every((e) => e.phase === 'saving' && e.total === 2)).toBe(true);
  });

  it('requires the employeeCode and ctcAnnual columns', async () => {
    const { service } = buildHarness();
    await expect(
      service.import(csv('employeeCode,effectiveFrom', 'E1,2026-04-01'), hr, true),
    ).rejects.toThrow('Missing required column: ctcAnnual');
  });
});

describe('bulk-import routes', () => {
  it('are HR Manager / Company Admin only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, PayrollController.prototype.importStructures)).toEqual([
      'COMPANY_ADMIN',
      'HR_MANAGER',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, EmployeesController.prototype.bulkImport)).toEqual([
      'COMPANY_ADMIN',
      'HR_MANAGER',
    ]);
  });
});
