import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { STATUS_LABELS, type LeaveRequestStatus } from '@/lib/leave/types';

export function fmtDate(iso: string): string {
  return new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "11–12 Aug 2026" / "15 Sep 2026" */
export function fmtRange(start: string, end: string): string {
  if (start === end) return fmtDate(start);
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  if (sameMonth) {
    return `${s.getDate()}–${e.getDate()} ${e.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`;
  }
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}

export function dayLabel(days: number): string {
  return `${days % 1 === 0 ? days : days.toFixed(1)}d`;
}

const STATUS_VARIANT: Record<LeaveRequestStatus, 'default' | 'success' | 'warning' | 'destructive'> = {
  PENDING_L1: 'warning',
  PENDING_L2: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
  CANCELLED: 'default',
};

export function LeaveStatusBadge({ status }: { status: LeaveRequestStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function LopBadge({ className }: { className?: string }) {
  return (
    <Badge variant="warning" className={className} title="Loss of pay — exceeds available balance">
      LOP
    </Badge>
  );
}

/** Small colored dot + code, for calendars and dense rows. */
export function LeaveTypeChip({
  code,
  colorToken,
  className,
}: {
  code: string;
  colorToken: string;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', className)}>
      <span className="h-2 w-2 rounded-full" style={{ background: colorToken }} />
      {code}
    </span>
  );
}

export function MockDataNote() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
      <span className="h-1.5 w-1.5 rounded-full bg-warning" />
      Mock data
    </span>
  );
}
