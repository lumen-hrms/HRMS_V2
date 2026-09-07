import * as React from 'react';
import { CheckCheck, Inbox } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import {
  LeaveTypeChip,
  LopBadge,
  dayLabel,
  fmtDate,
  fmtRange,
} from '@/pages/leave/shared';
import { RequestDetailSheet } from '@/pages/leave/components/request-detail-sheet';
import { leaveApi } from '@/lib/leave/client';
import type { LeaveRequest } from '@/lib/leave/types';
import { useLeaveCtx } from '@/pages/leave/use-leave-ctx';

/**
 * Approvals queue. Same screen for every approver — the level acted on comes
 * from each request's status (`PENDING_L1` → manager, `PENDING_L2` → HR), so a
 * Line Manager sees L1 items and HR/Admin see L2 (plus any L1 they also own).
 * Row → detail sheet with a comment box; inline buttons for the quick path;
 * multi-select for bulk approve.
 */
export function ApprovalsTab({ refreshKey, onDecided }: { refreshKey: number; onDecided: () => void }) {
  const ctx = useLeaveCtx();
  const { toast } = useToast();
  const [rows, setRows] = React.useState<LeaveRequest[] | null>(null);
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [selected, setSelected] = React.useState<LeaveRequest | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    if (!ctx) return;
    setRows(null);
    leaveApi.pendingApprovals(ctx).then((r) => {
      setRows(r);
      setChecked(new Set());
    });
  }, [ctx]);

  React.useEffect(load, [load, refreshKey]);

  if (!ctx) {
    return <p className="text-sm text-muted-foreground">This account has no linked employee record.</p>;
  }

  async function decide(id: string, action: 'approve' | 'reject', comment?: string) {
    if (!ctx) return;
    setBusy(true);
    try {
      await leaveApi.decide(id, action, ctx, comment);
      toast({
        title: action === 'approve' ? 'Request approved' : 'Request rejected',
        tone: action === 'approve' ? 'success' : 'info',
      });
      onDecided();
      load();
    } finally {
      setBusy(false);
    }
  }

  async function bulkApprove() {
    if (!ctx || checked.size === 0) return;
    setBusy(true);
    try {
      for (const id of checked) await leaveApi.decide(id, 'approve', ctx);
      toast({ title: `${checked.size} request${checked.size > 1 ? 's' : ''} approved`, tone: 'success' });
      onDecided();
      load();
    } finally {
      setBusy(false);
    }
  }

  const list = rows ?? [];
  const allChecked = list.length > 0 && checked.size === list.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {rows == null
            ? 'Loading…'
            : list.length === 0
              ? 'Nothing waiting on you.'
              : `${list.length} request${list.length > 1 ? 's' : ''} awaiting your decision.`}
        </p>
        {checked.size > 0 && (
          <Button size="sm" disabled={busy} onClick={bulkApprove}>
            <CheckCheck className="h-4 w-4" /> Approve selected ({checked.size})
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        {rows == null ? (
          <div className="p-4">
            <SkeletonRows rows={5} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Inbox zero"
            description="Approved and rejected requests move to All Requests / the employee's history."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    className="h-4 w-4 rounded border-input"
                    checked={allChecked}
                    onChange={(e) =>
                      setChecked(e.target.checked ? new Set(list.map((r) => r.id)) : new Set())
                    }
                  />
                </TH>
                <TH>Employee</TH>
                <TH>Type</TH>
                <TH>Dates</TH>
                <TH className="text-right">Days</TH>
                <TH>Submitted</TH>
                <TH className="text-right">Decision</TH>
              </TR>
            </THead>
            <TBody>
              {list.map((r) => (
                <TR
                  key={r.id}
                  className="cursor-pointer hover:bg-accent"
                  onClick={() => {
                    setSelected(r);
                    setSheetOpen(true);
                  }}
                >
                  <TD onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.employee.firstName}`}
                      className="h-4 w-4 rounded border-input"
                      checked={checked.has(r.id)}
                      onChange={(e) => {
                        const next = new Set(checked);
                        if (e.target.checked) next.add(r.id);
                        else next.delete(r.id);
                        setChecked(next);
                      }}
                    />
                  </TD>
                  <TD>
                    <div className="font-medium">
                      {r.employee.firstName} {r.employee.lastName}
                    </div>
                    <div className="text-xs text-muted-foreground">{r.employee.department ?? '—'}</div>
                  </TD>
                  <TD>
                    <span className="flex items-center gap-1.5">
                      <LeaveTypeChip code={r.leaveType.code} colorToken={r.leaveType.colorToken} />
                      {r.isLop && <LopBadge />}
                    </span>
                  </TD>
                  <TD>
                    {fmtRange(r.startDate, r.endDate)}
                    {r.halfDay && <span className="ml-1 text-xs text-muted-foreground">½</span>}
                  </TD>
                  <TD className="text-right tabular-nums">{dayLabel(r.days)}</TD>
                  <TD className="text-muted-foreground">{fmtDate(r.createdAt)}</TD>
                  <TD onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        onClick={() => decide(r.id, 'reject')}
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        variant="success"
                        disabled={busy}
                        onClick={() => decide(r.id, 'approve')}
                      >
                        Approve
                      </Button>
                    </div>
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
          selected
            ? { kind: 'decide', run: (action, comment) => decide(selected.id, action, comment) }
            : undefined
        }
      />
    </div>
  );
}
