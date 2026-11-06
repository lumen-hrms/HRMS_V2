import { BadRequestException } from '@nestjs/common';
import { LeavePolicyRecalcService } from './leave-policy-recalc.service';
import { LeaveEntitlementService } from './leave-entitlement.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const actor: AuthenticatedUser = {
  sub: 'user-ca',
  tenantId: 't1',
  role: 'COMPANY_ADMIN',
  email: 'ca@x',
  employeeId: null,
};

/**
 * The `meta` situation: go-live defaulted to 29 Oct and the first credits
 * were made under the old decimal rule — EL 0.19 for October, Mental Well
 * Being 1.5 for the year. One employee has already taken a day of MWB, and
 * has an opening balance on another type that must never be touched.
 */
function build() {
  const db = {
    settings: { tenantId: 't1', fyStartMonth: 4, goLiveDate: d('2026-10-29') as Date | null },
    types: [
      {
        id: 'el',
        code: 'EL',
        active: true,
        isCompOff: false,
        grantMode: 'ACCRUED',
        annualQuota: 24,
        carryForwardCap: 0,
        accrualFrequency: 'MONTHLY',
      },
      {
        id: 'mwb',
        code: 'MWB',
        active: true,
        isCompOff: false,
        grantMode: 'ACCRUED',
        annualQuota: 3,
        carryForwardCap: 0,
        accrualFrequency: 'ANNUAL',
      },
      {
        id: 'cl',
        code: 'CL',
        active: true,
        isCompOff: false,
        grantMode: 'ACCRUED',
        annualQuota: 8,
        carryForwardCap: 0,
        accrualFrequency: 'ANNUAL',
      },
    ],
    employees: [
      {
        id: 'e1',
        employeeCode: 'META033',
        firstName: 'Anish',
        lastName: 'G',
        dateOfJoining: d('2026-10-01'),
        lifecycleState: 'CONFIRMED',
      },
    ],
    balances: [
      { id: 'b-el', employeeId: 'e1', leaveTypeId: 'el', year: 2026, accrued: 0.19, used: 0 },
      { id: 'b-mwb', employeeId: 'e1', leaveTypeId: 'mwb', year: 2026, accrued: 1.5, used: 1 },
      { id: 'b-cl', employeeId: 'e1', leaveTypeId: 'cl', year: 2026, accrued: 5, used: 0 },
    ] as any[],
    ledger: [
      {
        employeeId: 'e1',
        leaveTypeId: 'el',
        source: 'ACCRUAL',
        delta: 0.19,
        occurredAt: d('2026-10-29'),
      },
      {
        employeeId: 'e1',
        leaveTypeId: 'mwb',
        source: 'ACCRUAL',
        delta: 1.5,
        occurredAt: d('2026-10-29'),
      },
      {
        employeeId: 'e1',
        leaveTypeId: 'cl',
        source: 'OPENING_BALANCE',
        delta: 5,
        occurredAt: d('2026-10-29'),
      },
    ] as any[],
  };
  const inIds = (v: string, f?: { in: string[] }) => !f || f.in.includes(v);
  const tx: any = {
    $executeRaw: jest.fn(),
    tenantSettings: {
      findUniqueOrThrow: jest.fn(async () => ({ ...db.settings })),
      findUnique: jest.fn(async () => ({ ...db.settings })),
      update: jest.fn(async ({ data }: any) => Object.assign(db.settings, data)),
    },
    leaveType: {
      findMany: jest.fn(async ({ where }: any) =>
        db.types.filter(
          (t) =>
            (where.active === undefined || t.active === where.active) &&
            (where.isCompOff === undefined || t.isCompOff === where.isCompOff) &&
            (where.grantMode === undefined || t.grantMode === where.grantMode) &&
            inIds(t.id, where.id),
        ),
      ),
    },
    employee: {
      findMany: jest.fn(async ({ where }: any) =>
        db.employees.filter((e) => e.lifecycleState !== 'SEPARATED' && inIds(e.id, where.id)),
      ),
    },
    leaveBalance: {
      findMany: jest.fn(async ({ where }: any) =>
        db.balances
          .filter(
            (b) =>
              b.year === where.year &&
              inIds(b.leaveTypeId, where.leaveTypeId) &&
              inIds(b.employeeId, where.employeeId),
          )
          .map((b) => ({ ...b })),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const b = db.balances.find((x) => x.id === where.id);
        if (data.accrued.decrement !== undefined)
          b.accrued = Math.round((b.accrued - data.accrued.decrement) * 100) / 100;
        if (data.accrued.increment !== undefined)
          b.accrued = Math.round((b.accrued + data.accrued.increment) * 100) / 100;
        return b;
      }),
      createMany: jest.fn(async ({ data }: any) =>
        db.balances.push(...data.map((b: any, i: number) => ({ id: `new-${i}`, ...b }))),
      ),
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
      createMany: jest.fn(async ({ data }: any) => db.ledger.push(...data)),
    },
  };
  // A rolled-back preview leaves the DB as it was: snapshot and restore.
  const raw = {
    $transaction: jest.fn(async (fn: any) => {
      const snapshot = JSON.parse(
        JSON.stringify({ balances: db.balances, ledger: db.ledger, settings: db.settings }),
      );
      try {
        return await fn(tx);
      } catch (e) {
        db.balances = snapshot.balances;
        db.ledger = snapshot.ledger.map((l: any) => ({ ...l, occurredAt: new Date(l.occurredAt) }));
        db.settings = {
          ...snapshot.settings,
          goLiveDate: snapshot.settings.goLiveDate ? new Date(snapshot.settings.goLiveDate) : null,
        };
        throw e;
      }
    }),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new LeavePolicyRecalcService(
    { tenantId: 't1' } as any,
    raw as any,
    new LeaveEntitlementService(),
    audit as any,
  );
  const available = (typeId: string) => {
    const b = db.balances.find((x) => x.leaveTypeId === typeId);
    return Math.round((b.accrued - b.used) * 100) / 100;
  };
  return { service, db, audit, available };
}

const today = d('2026-10-29');

describe('LeavePolicyRecalcService', () => {
  it('re-applies credits under the whole-day rule with the same go-live (EL 0, MWB 1)', async () => {
    const { service, available } = build();

    const result = await service.recalculate({ dryRun: false }, actor, today);

    expect(available('el')).toBe(0); // 3 of 31 October days → 0
    expect(available('mwb')).toBe(0); // 3 × 154/365 → 1, minus the day already taken
    expect(available('cl')).toBe(5); // opening balance untouched
    expect(result.reversed).toBe(2);
  });

  it('corrects the go-live date and credits the full month and year from it', async () => {
    const { service, db, available } = build();

    const result = await service.recalculate(
      { goLiveDate: '2026-04-01', dryRun: false },
      actor,
      today,
    );

    expect(db.settings.goLiveDate).toEqual(d('2026-04-01'));
    // Joined 1 Oct, so October onward: EL 2 for October; MWB 3 × 182/365 → 1 (minus 1 used).
    expect(available('el')).toBe(2);
    expect(available('mwb')).toBe(0);
    expect(result.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employeeCode: 'META033',
          leaveTypeCode: 'EL',
          before: 0.19,
          after: 2,
        }),
      ]),
    );
  });

  it('previews without changing anything or writing an audit row', async () => {
    const { service, db, audit, available } = build();

    const preview = await service.recalculate(
      { goLiveDate: '2026-04-01', dryRun: true },
      actor,
      today,
    );

    expect(preview.dryRun).toBe(true);
    expect(preview.changes.find((c) => c.leaveTypeCode === 'EL')).toMatchObject({
      before: 0.19,
      after: 2,
    });
    expect(available('el')).toBe(0.19);
    expect(db.settings.goLiveDate).toEqual(d('2026-10-29'));
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('is repeatable: running it twice gives the same balances', async () => {
    const { service, available } = build();
    await service.recalculate({ goLiveDate: '2026-04-01', dryRun: false }, actor, today);
    const first = [available('el'), available('mwb')];

    const second = await service.recalculate({ dryRun: false }, actor, today);

    expect([available('el'), available('mwb')]).toEqual(first);
    expect(second.changes).toEqual([]);
  });

  it('flags balances that go negative because leave was already taken', async () => {
    const { service, db } = build();
    db.balances.find((b) => b.id === 'b-mwb').used = 1.5;

    const preview = await service.recalculate({ dryRun: true }, actor, today);

    expect(preview.negativeBalances).toBe(1);
  });

  it('audits an applied recalculation', async () => {
    const { service, audit } = build();
    await service.recalculate({ dryRun: false }, actor, today);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'leave.policy_recalculated' }),
    );
  });

  it('rejects a go-live date more than 90 days ahead or not a date', async () => {
    const { service } = build();
    await expect(
      service.recalculate({ goLiveDate: '2027-06-01', dryRun: true }, actor, today),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.recalculate({ goLiveDate: 'soon', dryRun: true }, actor, today),
    ).rejects.toThrow(BadRequestException);
  });
});
