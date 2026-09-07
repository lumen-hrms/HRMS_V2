import * as React from 'react';
import { CalendarDays, CalendarClock, Plane } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { BalanceCard } from '@/pages/leave/components/balance-card';
import { LeaveStatusBadge, dayLabel, fmtDate, fmtRange } from '@/pages/leave/shared';
import { leaveApi } from '@/lib/leave/client';
import { MOCK_CURRENT_YEAR } from '@/lib/leave/fixtures';
import type { Holiday, LeaveBalance, LeaveRequest } from '@/lib/leave/types';
import { useLeaveCtx } from '@/pages/leave/use-leave-ctx';

/**
 * Employee landing view for Leave: balances at a glance, the next holiday, and
 * in-flight requests. Every role sees their own version of this.
 */
export function OverviewTab({ onOpenRequest }: { onOpenRequest: (r: LeaveRequest) => void }) {
  const ctx = useLeaveCtx();
  const [balances, setBalances] = React.useState<LeaveBalance[] | null>(null);
  const [requests, setRequests] = React.useState<LeaveRequest[] | null>(null);
  const [holidays, setHolidays] = React.useState<Holiday[]>([]);

  React.useEffect(() => {
    if (!ctx) return;
    leaveApi.balances(ctx.employeeId, MOCK_CURRENT_YEAR).then(setBalances);
    leaveApi.requestsForEmployee(ctx.employeeId).then(setRequests);
    leaveApi.listHolidays(MOCK_CURRENT_YEAR).then(setHolidays);
  }, [ctx]);

  if (!ctx) {
    return <p className="text-sm text-muted-foreground">This account has no linked employee record.</p>;
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const nextHoliday = holidays.find((h) => h.date >= todayIso);
  const pending = (requests ?? []).filter(
    (r) => r.status === 'PENDING_L1' || r.status === 'PENDING_L2',
  );
  const upcoming = (requests ?? [])
    .filter((r) => r.status === 'APPROVED' && r.endDate >= todayIso)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          Your balances · {MOCK_CURRENT_YEAR}
        </h2>
        {!balances ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="h-40 animate-pulse bg-muted" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {balances.map((b) => (
              <BalanceCard key={b.leaveTypeId} balance={b} />
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <MiniStat
          icon={CalendarClock}
          label="Requests in flight"
          value={String(pending.length)}
          sub={pending.length ? 'Awaiting approval' : 'Nothing pending'}
        />
        <MiniStat
          icon={Plane}
          label="Next approved leave"
          value={upcoming[0] ? fmtRange(upcoming[0].startDate, upcoming[0].endDate) : '—'}
          sub={upcoming[0] ? `${upcoming[0].leaveType.code} · ${dayLabel(upcoming[0].days)}` : 'None scheduled'}
        />
        <MiniStat
          icon={CalendarDays}
          label="Next company holiday"
          value={nextHoliday ? nextHoliday.name : '—'}
          sub={nextHoliday ? fmtDate(nextHoliday.date) : 'None left this year'}
        />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Recent activity</h2>
        <Card className="divide-y divide-border">
          {!requests ? (
            <div className="p-4">
              <SkeletonRows rows={4} />
            </div>
          ) : requests.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No leave requests yet"
              description="Head to the Apply tab to book time off."
            />
          ) : (
            requests.slice(0, 6).map((r) => (
              <button
                key={r.id}
                onClick={() => onOpenRequest(r)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-accent"
              >
                <div>
                  <div className="font-medium">
                    {r.leaveType.name} · {fmtRange(r.startDate, r.endDate)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {dayLabel(r.days)} · requested {fmtDate(r.createdAt)}
                  </div>
                </div>
                <LeaveStatusBadge status={r.status} />
              </button>
            ))
          )}
        </Card>
      </section>
    </div>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card className="flex items-start gap-3 p-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-base font-semibold">{value}</p>
        <p className="truncate text-xs text-muted-foreground">{sub}</p>
      </div>
    </Card>
  );
}
