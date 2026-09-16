import { cn } from '@/lib/utils';
import { TENANT_STATUS_LABEL, type TenantStatus } from '../lib/types';

const TONE: Record<TenantStatus, string> = {
  ACTIVE: 'bg-success/15 text-success',
  TRIAL: 'bg-warning/15 text-warning',
  SUSPENDED: 'bg-destructive/15 text-destructive',
};
const DOT: Record<TenantStatus, string> = {
  ACTIVE: 'bg-success',
  TRIAL: 'bg-warning',
  SUSPENDED: 'bg-destructive',
};

export function TenantStatusPill({
  status,
  sub,
  className,
}: {
  status: TenantStatus;
  sub?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        TONE[status],
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', DOT[status])} />
      {TENANT_STATUS_LABEL[status]}
      {sub && <span className="font-normal opacity-80">· {sub}</span>}
    </span>
  );
}
