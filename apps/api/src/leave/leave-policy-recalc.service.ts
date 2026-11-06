import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantPrismaClientProvider } from '../prisma/tenant-prisma-client.provider';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { parseImportDate } from '../common/bulk-import';
import { LeaveEntitlementService } from './leave-entitlement.service';
import {
  daysBetween,
  leaveYearWindow,
  periodContaining,
  round2,
  utcDay,
} from './leave-entitlement';
import { resolveLeaveYear } from './leave-year.util';

/** Thrown inside the transaction to roll a preview back after measuring it. */
class PreviewRollback extends Error {}

const MAX_GO_LIVE_AHEAD_DAYS = 90;
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const key = (employeeId: string, leaveTypeId: string) => `${employeeId}:${leaveTypeId}`;

export interface RecalcChange {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  leaveTypeCode: string;
  before: number;
  after: number;
}

/**
 * "Recalculate policy credits" (Leave › Settings, Company Admin) — the fix
 * for a wrong go-live date or credits made under an older rounding rule.
 *
 * For the current leave year it reverses every policy credit (`ACCRUAL`
 * entries) with an `ACCRUAL_REVERSAL` entry, optionally corrects
 * `tenant_settings.go_live_date`, and lets `LeaveEntitlementService` credit
 * everything again — all in one transaction. Opening balances,
 * carry-forward, HR adjustments, comp-off and event-based leave are never
 * touched, and leave already taken stays taken (a balance can go negative,
 * which the preview flags).
 *
 * The preview runs the exact same writes, measures the result, then rolls
 * the transaction back — so what it shows is what Apply does.
 */
@Injectable()
export class LeavePolicyRecalcService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly raw: TenantPrismaClientProvider,
    private readonly entitlement: LeaveEntitlementService,
    private readonly audit: AuditService,
  ) {}

  async recalculate(
    input: { goLiveDate?: string; dryRun: boolean },
    actor: AuthenticatedUser,
    now: Date = new Date(),
  ) {
    const goLive = input.goLiveDate ? parseImportDate(input.goLiveDate) : null;
    if (input.goLiveDate && !goLive) throw new BadRequestException('goLiveDate must be a date');
    if (goLive && daysBetween(utcDay(now), new Date(goLive)) > MAX_GO_LIVE_AHEAD_DAYS) {
      throw new BadRequestException(
        `Go-live can be at most ${MAX_GO_LIVE_AHEAD_DAYS} days from today`,
      );
    }

    const tenantId = this.tenantPrisma.tenantId;
    let result!: {
      leaveYear: number;
      goLiveDate: string | null;
      reversed: number;
      credited: number;
      changes: RecalcChange[];
    };

    try {
      await this.raw.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, TRUE)`;
          const settings = await tx.tenantSettings.findUniqueOrThrow({ where: { tenantId } });
          if (goLive) {
            await tx.tenantSettings.update({
              where: { tenantId },
              data: { goLiveDate: new Date(goLive) },
            });
          }
          const window = leaveYearWindow(
            resolveLeaveYear(utcDay(now), settings.fyStartMonth),
            settings.fyStartMonth,
          );
          const types = await tx.leaveType.findMany({
            where: { grantMode: 'ACCRUED', isCompOff: false },
            select: { id: true, code: true, accrualFrequency: true },
          });
          const typeIds = types.map((t) => t.id);
          const typeById = new Map(types.map((t) => [t.id, t]));

          const balancesNow = () =>
            tx.leaveBalance.findMany({
              where: { year: window.year, leaveTypeId: { in: typeIds } },
              select: { id: true, employeeId: true, leaveTypeId: true, accrued: true, used: true },
            });
          const before = await balancesNow();

          // Net policy credit per employee/type/period (earlier reversals included).
          const ledger = await tx.leaveLedgerEntry.findMany({
            where: {
              leaveTypeId: { in: typeIds },
              source: { in: ['ACCRUAL', 'ACCRUAL_REVERSAL'] },
              occurredAt: { gte: window.start, lt: window.end },
            },
            select: { employeeId: true, leaveTypeId: true, delta: true, occurredAt: true },
          });
          const groups = new Map<
            string,
            { employeeId: string; leaveTypeId: string; net: number; occurredAt: Date }
          >();
          for (const e of ledger) {
            const type = typeById.get(e.leaveTypeId)!;
            const period = periodContaining(type.accrualFrequency, window, e.occurredAt);
            if (!period) continue;
            const g = `${key(e.employeeId, e.leaveTypeId)}:${period.start.getTime()}`;
            const current = groups.get(g);
            groups.set(g, {
              employeeId: e.employeeId,
              leaveTypeId: e.leaveTypeId,
              net: round2((current?.net ?? 0) + num(e.delta)),
              // Dated inside the same period, so the engine nets them together.
              occurredAt:
                current && current.occurredAt < e.occurredAt ? current.occurredAt : e.occurredAt,
            });
          }

          const balanceByKey = new Map(before.map((b) => [key(b.employeeId, b.leaveTypeId), b]));
          const reversedByKey = new Map<string, number>();
          const reversals: {
            tenantId: string;
            employeeId: string;
            leaveTypeId: string;
            delta: number;
            balanceAfter: number;
            source: 'ACCRUAL_REVERSAL';
            note: string;
            occurredAt: Date;
            actorUserId: string;
          }[] = [];
          for (const g of groups.values()) {
            if (g.net <= 0) continue;
            const k = key(g.employeeId, g.leaveTypeId);
            const b = balanceByKey.get(k);
            const reversedSoFar = (reversedByKey.get(k) ?? 0) + g.net;
            reversedByKey.set(k, reversedSoFar);
            reversals.push({
              tenantId,
              employeeId: g.employeeId,
              leaveTypeId: g.leaveTypeId,
              delta: -g.net,
              balanceAfter: round2(num(b?.accrued) - reversedSoFar - num(b?.used)),
              source: 'ACCRUAL_REVERSAL',
              note: 'Policy recalculation: credit reversed, re-applied below',
              occurredAt: g.occurredAt,
              actorUserId: actor.sub,
            });
          }
          for (const [k, amount] of reversedByKey) {
            const b = balanceByKey.get(k);
            if (b) {
              await tx.leaveBalance.update({
                where: { id: b.id },
                data: { accrued: { decrement: amount } },
              });
            }
          }
          if (reversals.length > 0) await tx.leaveLedgerEntry.createMany({ data: reversals });

          const credited = await this.entitlement.applyPolicyDefaults(tx, tenantId, now);

          const after = await balancesNow();
          const avail = (b: { accrued: unknown; used: unknown } | undefined) =>
            b ? round2(num(b.accrued) - num(b.used)) : 0;
          const beforeByKey = new Map(before.map((b) => [key(b.employeeId, b.leaveTypeId), b]));
          const changed = after.filter(
            (b) => avail(b) !== avail(beforeByKey.get(key(b.employeeId, b.leaveTypeId))),
          );
          const employees = await tx.employee.findMany({
            where: { id: { in: [...new Set(changed.map((b) => b.employeeId))] } },
            select: { id: true, employeeCode: true, firstName: true, lastName: true },
          });
          const employeeById = new Map(employees.map((e) => [e.id, e]));
          result = {
            leaveYear: window.year,
            goLiveDate: goLive ?? settings.goLiveDate?.toISOString().slice(0, 10) ?? null,
            reversed: reversals.length,
            credited: credited.credited,
            changes: changed
              .map((b) => {
                const e = employeeById.get(b.employeeId);
                return {
                  employeeId: b.employeeId,
                  employeeCode: e?.employeeCode ?? '',
                  employeeName: e ? `${e.firstName} ${e.lastName}` : '',
                  leaveTypeCode: typeById.get(b.leaveTypeId)?.code ?? '',
                  before: avail(beforeByKey.get(key(b.employeeId, b.leaveTypeId))),
                  after: avail(b),
                };
              })
              .sort(
                (a, b) =>
                  a.employeeCode.localeCompare(b.employeeCode) ||
                  a.leaveTypeCode.localeCompare(b.leaveTypeCode),
              ),
          };
          if (input.dryRun) throw new PreviewRollback();
        },
        { timeout: 120_000, maxWait: 15_000 },
      );
    } catch (err) {
      if (!(err instanceof PreviewRollback)) throw err;
    }

    if (!input.dryRun) {
      await this.audit.log({
        actorUserId: actor.sub,
        action: 'leave.policy_recalculated',
        targetType: 'tenant',
        targetId: tenantId,
        metadata: {
          module: 'leave',
          actorName: actor.email,
          actorRole: actor.role,
          leaveYear: result.leaveYear,
          goLiveDate: result.goLiveDate,
          reversed: result.reversed,
          credited: result.credited,
          balancesChanged: result.changes.length,
        },
      });
    }
    return {
      dryRun: input.dryRun,
      ...result,
      negativeBalances: result.changes.filter((c) => c.after < 0).length,
    };
  }
}
