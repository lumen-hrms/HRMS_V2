import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { availableDays, type LeaveBalance } from '@/lib/leave/types';

/**
 * One leave-type balance tile: available (big), then the arithmetic behind it.
 * `entitled = accrued + carriedForward`; the bar shows used + pending against
 * that.
 */
export function BalanceCard({ balance, compact }: { balance: LeaveBalance; compact?: boolean }) {
  const entitled = balance.accrued + balance.carriedForward;
  const available = availableDays(balance);
  const usedPct = entitled > 0 ? Math.min(100, (balance.used / entitled) * 100) : 0;
  const pendingPct = entitled > 0 ? Math.min(100 - usedPct, (balance.pending / entitled) * 100) : 0;

  return (
    <Card className={cn('flex flex-col gap-3 p-4', compact && 'gap-2 p-3')}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: balance.leaveType.colorToken }}
          />
          {balance.leaveType.name}
        </span>
        <span className="text-xs text-muted-foreground">{balance.leaveType.code}</span>
      </div>

      <div>
        <span className={cn('text-2xl font-bold tabular-nums', available < 0 && 'text-destructive')}>
          {available % 1 === 0 ? available : available.toFixed(1)}
        </span>
        <span className="ml-1 text-sm text-muted-foreground">available</span>
      </div>

      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
        <span className="bg-primary" style={{ width: `${usedPct}%` }} />
        <span className="bg-warning" style={{ width: `${pendingPct}%` }} />
      </div>

      {!compact && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <Line label="Accrued" value={balance.accrued} />
          <Line label="Carried fwd" value={balance.carriedForward} />
          <Line label="Used" value={balance.used} />
          <Line label="Pending" value={balance.pending} />
        </dl>
      )}
    </Card>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <dt>{label}</dt>
      <dd className="font-medium text-foreground tabular-nums">
        {value % 1 === 0 ? value : value.toFixed(1)}
      </dd>
    </div>
  );
}
