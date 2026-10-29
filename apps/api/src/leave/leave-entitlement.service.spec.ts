import { LeaveEntitlementService } from './leave-entitlement.service';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

/**
 * In-memory stand-in for the tenant-scoped client — just enough `where`
 * support for the queries the service makes, so a second run can see what
 * the first one wrote.
 */
function fakeClient(seed: {
  settings?: Record<string, unknown> | null;
  types?: Record<string, unknown>[];
  employees?: Record<string, unknown>[];
  balances?: Record<string, unknown>[];
  ledger?: Record<string, unknown>[];
}) {
  const db = {
    types: seed.types ?? [],
    employees: seed.employees ?? [],
    balances: [...(seed.balances ?? [])] as any[],
    ledger: [...(seed.ledger ?? [])] as any[],
  };
  const inIds = (value: string, filter?: { in: string[] }) => !filter || filter.in.includes(value);
  const client = {
    tenantSettings: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          seed.settings === undefined ? { fyStartMonth: 4, goLiveDate: null } : seed.settings,
        ),
    },
    leaveType: {
      findMany: jest.fn(async ({ where }: any) =>
        db.types.filter(
          (t: any) =>
            (where.active === undefined || t.active === where.active) &&
            (where.isCompOff === undefined || t.isCompOff === where.isCompOff) &&
            inIds(t.id, where.id),
        ),
      ),
    },
    employee: {
      findMany: jest.fn(async ({ where }: any) =>
        db.employees.filter((e: any) => e.lifecycleState !== 'SEPARATED' && inIds(e.id, where.id)),
      ),
    },
    leaveBalance: {
      findMany: jest.fn(async ({ where }: any) =>
        db.balances.filter(
          (b) =>
            b.year === where.year &&
            inIds(b.employeeId, where.employeeId) &&
            inIds(b.leaveTypeId, where.leaveTypeId),
        ),
      ),
      createMany: jest.fn(async ({ data }: any) => {
        data.forEach((b: any, i: number) =>
          db.balances.push({ id: `bal-new-${db.balances.length + i}`, ...b }),
        );
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const b = db.balances.find((x) => x.id === where.id);
        b.accrued = Number(b.accrued) + data.accrued.increment;
        return b;
      }),
    },
    leaveLedgerEntry: {
      findMany: jest.fn(async ({ where }: any) => {
        const sources: string[] = where.source.in ?? [where.source];
        return db.ledger.filter(
          (l) =>
            sources.includes(l.source) &&
            inIds(l.employeeId, where.employeeId) &&
            inIds(l.leaveTypeId, where.leaveTypeId) &&
            l.occurredAt >= where.occurredAt.gte &&
            l.occurredAt < where.occurredAt.lt,
        );
      }),
      createMany: jest.fn(async ({ data }: any) => {
        db.ledger.push(...data);
      }),
    },
  };
  return { client, db };
}

const annual = {
  id: 'cl',
  active: true,
  isCompOff: false,
  annualQuota: 12,
  carryForwardCap: 0,
  accrualFrequency: 'ANNUAL',
};
const monthly = {
  id: 'el',
  active: true,
  isCompOff: false,
  annualQuota: 12,
  carryForwardCap: 10,
  accrualFrequency: 'MONTHLY',
};
const compOff = {
  id: 'co',
  active: true,
  isCompOff: true,
  annualQuota: 0,
  carryForwardCap: 0,
  accrualFrequency: 'ANNUAL',
};

describe('LeaveEntitlementService.applyPolicyDefaults', () => {
  const service = new LeaveEntitlementService();

  it('prorates from go-live and writes one balance + ledger entry per credit', async () => {
    const { client, db } = fakeClient({
      settings: { fyStartMonth: 4, goLiveDate: d('2026-10-01') },
      types: [annual, monthly, compOff],
      employees: [{ id: 'e1', dateOfJoining: d('2019-06-01') }],
    });

    await service.applyPolicyDefaults(client, 't1', d('2026-10-20'));

    expect(db.balances).toEqual([
      expect.objectContaining({ employeeId: 'e1', leaveTypeId: 'cl', year: 2026, accrued: 6 }),
      expect.objectContaining({ employeeId: 'e1', leaveTypeId: 'el', year: 2026, accrued: 1 }),
    ]);
    expect(db.ledger.map((l) => [l.leaveTypeId, l.source, l.delta])).toEqual([
      ['cl', 'ACCRUAL', 6],
      ['el', 'ACCRUAL', 1],
    ]);
  });

  it('is idempotent: a second run the same day writes nothing', async () => {
    const { client, db } = fakeClient({
      settings: { fyStartMonth: 4, goLiveDate: d('2026-10-01') },
      types: [annual, monthly],
      employees: [{ id: 'e1', dateOfJoining: null }],
    });
    await service.applyPolicyDefaults(client, 't1', d('2026-10-20'));
    const after = { balances: db.balances.length, ledger: db.ledger.length };

    const second = await service.applyPolicyDefaults(client, 't1', d('2026-10-20'));

    expect(second).toEqual({ credited: 0, balancesCreated: 0 });
    expect({ balances: db.balances.length, ledger: db.ledger.length }).toEqual(after);
  });

  it('credits the next month on top of an existing balance a month later', async () => {
    const { client, db } = fakeClient({
      settings: { fyStartMonth: 4, goLiveDate: d('2026-10-01') },
      types: [monthly],
      employees: [{ id: 'e1', dateOfJoining: null }],
    });
    await service.applyPolicyDefaults(client, 't1', d('2026-10-20'));
    await service.applyPolicyDefaults(client, 't1', d('2026-11-01'));

    expect(db.balances).toHaveLength(1);
    expect(db.balances[0].accrued).toBe(2);
    expect(db.ledger.at(-1)).toMatchObject({ delta: 1, balanceAfter: 2 });
  });

  it('skips the ANNUAL grant for an employee with an imported opening balance', async () => {
    const { client, db } = fakeClient({
      settings: { fyStartMonth: 4, goLiveDate: d('2026-10-01') },
      types: [annual],
      employees: [{ id: 'e1', dateOfJoining: null }],
      balances: [
        { id: 'b1', employeeId: 'e1', leaveTypeId: 'cl', year: 2026, accrued: 9, used: 0 },
      ],
      ledger: [
        {
          employeeId: 'e1',
          leaveTypeId: 'cl',
          source: 'OPENING_BALANCE',
          delta: 9,
          occurredAt: d('2026-10-01'),
        },
      ],
    });

    await service.applyPolicyDefaults(client, 't1', d('2026-10-20'));

    expect(db.balances[0].accrued).toBe(9);
    expect(db.ledger).toHaveLength(1);
  });

  it('never credits comp-off types or separated employees, and only the requested employees', async () => {
    const { client, db } = fakeClient({
      types: [annual, compOff],
      employees: [
        { id: 'e1', dateOfJoining: null },
        { id: 'e2', dateOfJoining: null },
        { id: 'gone', dateOfJoining: null, lifecycleState: 'SEPARATED' },
      ],
    });

    await service.applyPolicyDefaults(client, 't1', d('2026-10-20'), {
      employeeIds: ['e1', 'gone'],
    });

    expect(db.balances.map((b) => [b.employeeId, b.leaveTypeId])).toEqual([['e1', 'cl']]);
  });

  it('does nothing for an empty employee list or a tenant with no settings', async () => {
    const { client } = fakeClient({ settings: null, types: [annual], employees: [{ id: 'e1' }] });
    expect(
      await service.applyPolicyDefaults(client, 't1', d('2026-10-20'), { employeeIds: [] }),
    ).toEqual({
      credited: 0,
      balancesCreated: 0,
    });
    expect(await service.applyPolicyDefaults(client, 't1', d('2026-10-20'))).toEqual({
      credited: 0,
      balancesCreated: 0,
    });
  });
});

describe('LeaveEntitlementService.applyCarryForward', () => {
  const service = new LeaveEntitlementService();
  const seed = () => ({
    types: [monthly],
    employees: [{ id: 'e1' }],
    balances: [
      { id: 'prev', employeeId: 'e1', leaveTypeId: 'el', year: 2025, accrued: 14, used: 2 },
    ],
  });

  it('rolls unused balance into the new year, capped, in the first week of the year', async () => {
    const { client, db } = fakeClient(seed());

    await service.applyCarryForward(client, 't1', d('2026-04-02'));

    expect(db.balances.find((b) => b.year === 2026)).toMatchObject({ accrued: 10 });
    expect(db.ledger).toEqual([
      expect.objectContaining({ source: 'CARRY_FORWARD', delta: 10, occurredAt: d('2026-04-01') }),
    ]);
  });

  it('never carries forward twice', async () => {
    const { client, db } = fakeClient(seed());
    await service.applyCarryForward(client, 't1', d('2026-04-02'));
    await service.applyCarryForward(client, 't1', d('2026-04-03'));

    expect(db.ledger).toHaveLength(1);
  });

  it('does nothing after the first week of the leave year', async () => {
    const { client, db } = fakeClient(seed());

    await service.applyCarryForward(client, 't1', d('2026-04-09'));

    expect(db.ledger).toHaveLength(0);
  });
});
