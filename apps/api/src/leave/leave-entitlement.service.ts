import { Injectable } from '@nestjs/common';
import { resolveLeaveYear } from './leave-year.util';
import {
  carryForwardDays,
  creditsDue,
  effectiveStart,
  leaveYearWindow,
  periodContaining,
  round2,
  utcDay,
  type AccrualFrequencyKey,
  type Credit,
} from './leave-entitlement';

/**
 * The slice of a tenant-scoped Prisma client this service needs — satisfied
 * by `withTenantContext(...)` (the daily job), `TenantPrismaService.client`
 * (a request) and an interactive transaction client with the RLS session
 * variable already set (company setup's submit). Same structural-typing
 * approach as `PayrollSeedClient`.
 */
export interface EntitlementClient {
  tenantSettings: { findUnique(args: any): Promise<any> };
  leaveType: { findMany(args: any): Promise<any[]> };
  employee: { findMany(args: any): Promise<any[]> };
  leaveBalance: {
    findMany(args: any): Promise<any[]>;
    createMany(args: any): Promise<unknown>;
    update(args: any): Promise<any>;
  };
  leaveLedgerEntry: {
    findMany(args: any): Promise<any[]>;
    createMany(args: any): Promise<unknown>;
  };
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const key = (employeeId: string, leaveTypeId: string) => `${employeeId}:${leaveTypeId}`;

interface Writes {
  newBalances: { employeeId: string; leaveTypeId: string; accrued: number }[];
  increments: { id: string; by: number }[];
  ledger: {
    employeeId: string;
    leaveTypeId: string;
    delta: number;
    balanceAfter: number;
    source: 'ACCRUAL' | 'CARRY_FORWARD';
    note: string;
    occurredAt: Date;
  }[];
}

/**
 * Applies the tenant's leave policy to balances (module 04 "Entitlement"):
 * the daily accrual job runs both methods for every set-up tenant; a newly
 * created employee and company setup's submit run `applyPolicyDefaults` for
 * just the employees they wrote. Every write is guarded by the ledger, so
 * running either method twice changes nothing the second time.
 */
@Injectable()
export class LeaveEntitlementService {
  /**
   * Credits whatever the policy owes for the current leave year and isn't in
   * the ledger yet: the prorated ANNUAL grant, and every MONTHLY/QUARTERLY
   * period that has started. Comp-off types are skipped (credited per
   * holiday worked, not by policy) and so are separated employees.
   */
  async applyPolicyDefaults(
    client: EntitlementClient,
    tenantId: string,
    today: Date = new Date(),
    opts: { employeeIds?: string[]; leaveTypeIds?: string[] } = {},
  ): Promise<{ credited: number; balancesCreated: number }> {
    if (opts.employeeIds && opts.employeeIds.length === 0)
      return { credited: 0, balancesCreated: 0 };
    const day = utcDay(today);
    const settings = await client.tenantSettings.findUnique({ where: { tenantId } });
    if (!settings) return { credited: 0, balancesCreated: 0 };
    const window = leaveYearWindow(
      resolveLeaveYear(day, settings.fyStartMonth),
      settings.fyStartMonth,
    );
    const goLive: Date | null = settings.goLiveDate ?? null;

    const employeeFilter = opts.employeeIds ? { id: { in: opts.employeeIds } } : {};
    const [types, employees] = await Promise.all([
      client.leaveType.findMany({
        where: {
          active: true,
          isCompOff: false,
          // Event-based types (maternity, marriage, …) are granted per request, never by policy.
          grantMode: 'ACCRUED',
          ...(opts.leaveTypeIds ? { id: { in: opts.leaveTypeIds } } : {}),
        },
      }),
      client.employee.findMany({
        where: { ...employeeFilter, lifecycleState: { not: 'SEPARATED' } },
        select: { id: true, dateOfJoining: true },
      }),
    ]);
    const policyTypes = types.filter((t) => num(t.annualQuota) > 0);
    if (policyTypes.length === 0 || employees.length === 0)
      return { credited: 0, balancesCreated: 0 };

    const employeeIds = employees.map((e) => e.id);
    const typeIds = policyTypes.map((t) => t.id);
    const [ledger, balances] = await Promise.all([
      client.leaveLedgerEntry.findMany({
        where: {
          employeeId: { in: employeeIds },
          leaveTypeId: { in: typeIds },
          source: { in: ['ACCRUAL', 'ACCRUAL_REVERSAL', 'OPENING_BALANCE'] },
          occurredAt: { gte: window.start, lt: window.end },
        },
        select: {
          employeeId: true,
          leaveTypeId: true,
          source: true,
          delta: true,
          occurredAt: true,
        },
      }),
      client.leaveBalance.findMany({
        where: { employeeId: { in: employeeIds }, leaveTypeId: { in: typeIds }, year: window.year },
      }),
    ]);

    const typeById = new Map(policyTypes.map((t) => [t.id, t]));
    const accrued = new Map<string, number>();
    // Net credit per employee/type/period: an ACCRUAL_REVERSAL (policy
    // recalculation) cancels its period's ACCRUAL, so that period is owed again.
    const netByPeriod = new Map<string, Map<number, number>>();
    const hasOpening = new Set<string>();
    for (const entry of ledger) {
      const k = key(entry.employeeId, entry.leaveTypeId);
      if (entry.source === 'OPENING_BALANCE') {
        hasOpening.add(k);
        continue;
      }
      accrued.set(k, num(accrued.get(k)) + num(entry.delta));
      const type = typeById.get(entry.leaveTypeId);
      const period = type && periodContaining(type.accrualFrequency, window, entry.occurredAt);
      if (period) {
        const periods = netByPeriod.get(k) ?? new Map<number, number>();
        const t = period.start.getTime();
        periods.set(t, round2((periods.get(t) ?? 0) + num(entry.delta)));
        netByPeriod.set(k, periods);
      }
    }
    const creditedPeriods = new Map<string, Set<number>>();
    for (const [k, periods] of netByPeriod) {
      creditedPeriods.set(
        k,
        new Set([...periods].filter(([, net]) => net > 0).map(([start]) => start)),
      );
    }
    const balanceByKey = new Map(balances.map((b) => [key(b.employeeId, b.leaveTypeId), b]));

    const writes: Writes = { newBalances: [], increments: [], ledger: [] };
    for (const emp of employees) {
      const start = effectiveStart(window, emp.dateOfJoining ?? null, goLive);
      for (const type of policyTypes) {
        const k = key(emp.id, type.id);
        const credits = creditsDue({
          accrualFrequency: type.accrualFrequency as AccrualFrequencyKey,
          annualQuota: num(type.annualQuota),
          window,
          effectiveStart: start,
          today: day,
          creditedPeriodStarts: creditedPeriods.get(k) ?? new Set(),
          accruedSoFar: num(accrued.get(k)),
          hasOpeningBalance: hasOpening.has(k),
        });
        if (credits.length > 0) {
          this.plan(writes, emp.id, type.id, balanceByKey.get(k), credits, 'ACCRUAL', (c) =>
            type.accrualFrequency === 'ANNUAL'
              ? `Leave-year ${window.year} entitlement`
              : `Periodic accrual for ${c.periodStart.toISOString().slice(0, 7)}`,
          );
        }
      }
    }
    return this.write(client, tenantId, window.year, writes);
  }

  /**
   * Rolls unused balance from the previous leave year into the current one,
   * capped per type, during the first week of a new leave year (a week, not
   * one day, so a missed job run still catches up). Once an employee/type
   * has a CARRY_FORWARD entry this year it's never repeated.
   */
  async applyCarryForward(
    client: EntitlementClient,
    tenantId: string,
    today: Date = new Date(),
  ): Promise<{ credited: number; balancesCreated: number }> {
    const day = utcDay(today);
    const settings = await client.tenantSettings.findUnique({ where: { tenantId } });
    if (!settings) return { credited: 0, balancesCreated: 0 };
    const window = leaveYearWindow(
      resolveLeaveYear(day, settings.fyStartMonth),
      settings.fyStartMonth,
    );
    const firstWeekEnd = new Date(window.start.getTime() + 7 * 86_400_000);
    if (day >= firstWeekEnd) return { credited: 0, balancesCreated: 0 };

    const types = (
      await client.leaveType.findMany({ where: { active: true, grantMode: 'ACCRUED' } })
    ).filter((t) => num(t.carryForwardCap) > 0);
    if (types.length === 0) return { credited: 0, balancesCreated: 0 };
    const typeIds = types.map((t) => t.id);
    const employees = await client.employee.findMany({
      where: { lifecycleState: { not: 'SEPARATED' } },
      select: { id: true },
    });
    const employeeIds = employees.map((e) => e.id);
    const [previous, current, alreadyCarried] = await Promise.all([
      client.leaveBalance.findMany({
        where: {
          employeeId: { in: employeeIds },
          leaveTypeId: { in: typeIds },
          year: window.year - 1,
        },
      }),
      client.leaveBalance.findMany({
        where: { employeeId: { in: employeeIds }, leaveTypeId: { in: typeIds }, year: window.year },
      }),
      client.leaveLedgerEntry.findMany({
        where: {
          employeeId: { in: employeeIds },
          leaveTypeId: { in: typeIds },
          source: 'CARRY_FORWARD',
          occurredAt: { gte: window.start, lt: window.end },
        },
        select: { employeeId: true, leaveTypeId: true },
      }),
    ]);
    const done = new Set(alreadyCarried.map((e) => key(e.employeeId, e.leaveTypeId)));
    const currentByKey = new Map(current.map((b) => [key(b.employeeId, b.leaveTypeId), b]));
    const capByType = new Map(types.map((t) => [t.id, num(t.carryForwardCap)]));

    const writes: Writes = { newBalances: [], increments: [], ledger: [] };
    for (const prev of previous) {
      const k = key(prev.employeeId, prev.leaveTypeId);
      if (done.has(k)) continue;
      const amount = carryForwardDays(
        num(prev.accrued) - num(prev.used),
        capByType.get(prev.leaveTypeId) ?? 0,
      );
      if (amount <= 0) continue;
      this.plan(
        writes,
        prev.employeeId,
        prev.leaveTypeId,
        currentByKey.get(k),
        [{ periodStart: window.start, occurredAt: window.start, amount }],
        'CARRY_FORWARD',
        () => `Carried forward from leave year ${window.year - 1}`,
      );
    }
    return this.write(client, tenantId, window.year, writes);
  }

  private plan(
    writes: Writes,
    employeeId: string,
    leaveTypeId: string,
    balance: { id: string; accrued: unknown; used: unknown } | undefined,
    credits: Credit[],
    source: 'ACCRUAL' | 'CARRY_FORWARD',
    noteFor: (c: Credit) => string,
  ) {
    const total = round2(credits.reduce((s, c) => s + c.amount, 0));
    let running = balance ? num(balance.accrued) - num(balance.used) : 0;
    for (const c of credits) {
      running = round2(running + c.amount);
      writes.ledger.push({
        employeeId,
        leaveTypeId,
        delta: c.amount,
        balanceAfter: running,
        source,
        note: noteFor(c),
        occurredAt: c.occurredAt,
      });
    }
    if (balance) writes.increments.push({ id: balance.id, by: total });
    else writes.newBalances.push({ employeeId, leaveTypeId, accrued: total });
  }

  private async write(client: EntitlementClient, tenantId: string, year: number, writes: Writes) {
    if (writes.newBalances.length > 0) {
      await client.leaveBalance.createMany({
        data: writes.newBalances.map((b) => ({ tenantId, year, used: 0, ...b })),
      });
    }
    for (const inc of writes.increments) {
      await client.leaveBalance.update({
        where: { id: inc.id },
        data: { accrued: { increment: inc.by } },
      });
    }
    if (writes.ledger.length > 0) {
      await client.leaveLedgerEntry.createMany({
        data: writes.ledger.map((l) => ({ tenantId, actorUserId: null, ...l })),
      });
    }
    return { credited: writes.ledger.length, balancesCreated: writes.newBalances.length };
  }
}
