import { cn } from '@/lib/utils';
import { seatPressure } from '../lib/types';

const FILL: Record<string, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  muted: 'bg-muted-foreground/40',
};
const TEXT: Record<string, string> = {
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
  muted: 'text-muted-foreground',
};

export function SeatPressureBar({
  employeeCount,
  seats,
  className,
}: {
  employeeCount: number;
  seats: number | undefined;
  className?: string;
}) {
  const { pct, tone, over } = seatPressure(employeeCount, seats);
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {employeeCount} / {seats ?? '—'} seats
        </span>
        <span className={cn('font-semibold', TEXT[tone])}>{seats ? `${pct}%` : '—'}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', FILL[tone])}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      {over && (
        <span className="text-[11px] font-medium text-destructive">Over seat limit</span>
      )}
    </div>
  );
}
