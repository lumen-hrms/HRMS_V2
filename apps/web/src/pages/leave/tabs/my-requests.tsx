import * as React from 'react';
import { CalendarX2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  LeaveStatusBadge,
  LeaveTypeChip,
  LopBadge,
  dayLabel,
  fmtDate,
  fmtRange,
} from '@/pages/leave/shared';
import { RequestDetailSheet } from '@/pages/leave/components/request-detail-sheet';
import { leaveApi } from '@/lib/leave/client';
import type { LeaveRequest, LeaveRequestStatus } from '@/lib/leave/types';
import { useLeaveCtx } from '@/pages/leave/use-leave-ctx';

const FILTERS: { key: LeaveRequestStatus | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'PENDING_L1', label: 'Pending' },
  { key: 'PENDING_L2', label: 'With HR' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'CANCELLED', label: 'Cancelled' },
];

export function MyRequestsTab({ refreshKey }: { refreshKey: number }) {
  const ctx = useLeaveCtx();
  const { toast } = useToast();
  const [rows, setRows] = React.useState<LeaveRequest[] | null>(null);
  const [filter, setFilter] = React.useState<LeaveRequestStatus | 'ALL'>('ALL');
  const [selected, setSelected] = React.useState<LeaveRequest | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  const load = React.useCallback(() => {
    if (!ctx) return;
    leaveApi.requestsForEmployee(ctx.employeeId).then(setRows);
  }, [ctx]);

  React.useEffect(load, [load, refreshKey]);

  if (!ctx) {
    return <p className="text-sm text-muted-foreground">This account has no linked employee record.</p>;
  }

  const filtered = (rows ?? []).filter((r) => filter === 'ALL' || r.status === filter);

  async function cancel(id: string) {
    await leaveApi.cancelRequest(id);
    toast({ title: 'Request withdrawn', tone: 'info' });
    load();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const count =
            f.key === 'ALL'
              ? (rows ?? []).length
              : (rows ?? []).filter((r) => r.status === f.key).length;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                filter === f.key
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent',
              )}
            >
              {f.label}
              {count > 0 && <span className="ml-1.5 opacity-70">{count}</span>}
            </button>
          );
        })}
      </div>

      <Card className="overflow-hidden">
        {!rows ? (
          <div className="p-4">
            <SkeletonRows rows={5} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={CalendarX2}
            title={filter === 'ALL' ? 'No leave requests yet' : 'Nothing here'}
            description={
              filter === 'ALL' ? 'Your leave history will show up here.' : 'Try a different filter.'
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Type</TH>
                <TH>Dates</TH>
                <TH className="text-right">Days</TH>
                <TH>Requested</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((r) => (
                <TR
                  key={r.id}
                  className="cursor-pointer hover:bg-accent"
                  onClick={() => {
                    setSelected(r);
                    setSheetOpen(true);
                  }}
                >
                  <TD>
                    <LeaveTypeChip code={r.leaveType.code} colorToken={r.leaveType.colorToken} />
                  </TD>
                  <TD>{fmtRange(r.startDate, r.endDate)}</TD>
                  <TD className="text-right tabular-nums">{dayLabel(r.days)}</TD>
                  <TD className="text-muted-foreground">{fmtDate(r.createdAt)}</TD>
                  <TD>
                    <span className="flex items-center gap-1.5">
                      <LeaveStatusBadge status={r.status} />
                      {r.isLop && <LopBadge />}
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <RequestDetailSheet
        request={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        action={
          selected && (selected.status === 'PENDING_L1' || selected.status === 'PENDING_L2')
            ? { kind: 'cancel', run: () => cancel(selected.id) }
            : undefined
        }
      />
    </div>
  );
}
