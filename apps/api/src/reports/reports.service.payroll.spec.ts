import { BadRequestException } from '@nestjs/common';
import { ReportsService } from './reports.service';

function setup(runs: Array<{ id: string; period: string }>, items: unknown[] = []) {
  const runFind = jest.fn().mockResolvedValue(runs);
  const itemFind = jest.fn().mockResolvedValue(items);
  const client = {
    payrollRun: { findMany: runFind },
    payrollLineItem: { findMany: itemFind },
    fullAndFinalSettlement: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new ReportsService({ client } as never);
  return { service, runFind, itemFind };
}

const item = (runId: string) => ({
  runId,
  workingDays: 26,
  payableDays: 26,
  lopDays: 0,
  grossEarnings: '1000',
  epfEmployee: '0',
  epfEmployer: '0',
  esiEmployee: '0',
  esiEmployer: '0',
  professionalTax: '0',
  tdsDeducted: '0',
  netPay: '1000',
  calculationSnapshot: {},
  employee: {
    employeeCode: 'E1',
    firstName: 'A',
    lastName: 'B',
    uan: null,
    pfNumber: null,
    esicNumber: null,
    ctcAnnual: null,
    department: null,
  },
});

describe('ReportsService payroll reports', () => {
  it('only queries PROCESSED/DISBURSED runs', async () => {
    const { service, runFind } = setup([]);
    await service.run('salary-register', { period: '2026-09' });
    expect(runFind.mock.calls[0][0].where.status).toEqual({ in: ['PROCESSED', 'DISBURSED'] });
  });

  it('uses the latest run when a period was reprocessed', async () => {
    // Runs arrive newest-first (processedAt desc); the older one must be ignored.
    const { service, itemFind } = setup(
      [
        { id: 'new', period: '2026-09' },
        { id: 'old', period: '2026-09' },
      ],
      [item('new')],
    );
    const r = await service.run('salary-register', { period: '2026-09' });
    expect(itemFind.mock.calls[0][0].where.runId.in).toEqual(['new']);
    expect(r.table.rows.length).toBe(2); // 1 employee + TOTAL
  });

  it('returns an empty register without hitting line items when nothing is processed', async () => {
    const { service, itemFind } = setup([]);
    const r = await service.run('pf-register', { period: '2026-09' });
    expect(itemFind).not.toHaveBeenCalled();
    expect(r.table.rows).toEqual([]);
  });

  it('rejects a malformed period', async () => {
    const { service } = setup([]);
    await expect(service.run('esi-register', { period: '2026-13' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
