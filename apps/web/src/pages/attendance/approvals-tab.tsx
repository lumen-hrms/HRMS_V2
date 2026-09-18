import * as React from 'react';
import { CheckCheck, Inbox } from 'lucide-react';
import { api, isApiError } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';

const REASON_LABELS: Record<string, string> = {
  MISSED_PUNCH_IN: 'Missed Punch In',
  MISSED_PUNCH_OUT: 'Missed Punch Out',
  WRONG_PUNCH_TIME: 'Wrong Punch Time',
  FORGOT_TO_CLOCK_IN: 'Forgot to Clock In',
  FORGOT_TO_CLOCK_OUT: 'Forgot to Clock Out',
  ON_DUTY_FIELD_WORK: 'On-Duty / Field Work',
  OTHER: 'Other',
};

interface PendingRegularization {
  id: string;
  targetDate: string;
  reasonType: string;
  requestedCheckInAt: string | null;
  requestedCheckOutAt: string | null;
  note: string | null;
  createdAt: string;
  employee: { id: string; firstName: string; lastName: string; department: { name: string } | null };
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Regularization approval queue for a Line Manager (their recursive
 * subtree) or HR/Admin (everyone) — mirrors Leave's `ApprovalsTab` UI
 * pattern. Single decision level (no L1/L2 split — Leave's approve/reject
 * is per-request there too, this is the Attendance equivalent).
 */
export function AttendanceApprovalsTab() {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<PendingRegularization[] | null>(null);
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    setRows(null);
    api.get<PendingRegularization[]>('/attendance/regularization/pending').then((r) => {
      setRows(r);
      setChecked(new Set());
    });
  }, []);
  React.useEffect(load, [load]);

  async function decide(id: string, action: 'approve' | 'reject') {
    setBusy(true);
    try {
      await api.post(`/attendance/regularization/${id}/${action}`);
      toast({
        title: action === 'approve' ? 'Request approved' : 'Request rejected',
        tone: action === 'approve' ? 'success' : 'info',
      });
      load();
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Action failed', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function bulkApprove() {
    if (checked.size === 0) return;
    setBusy(true);
    try {
      const result = await api.post<{ id: string; ok: boolean }[]>(
        '/attendance/regularization/bulk-approve',
        { ids: [...checked] },
      );
      const failed = result.filter((r) => !r.ok).length;
      toast({
        title: failed
          ? `${result.length - failed} approved, ${failed} failed`
          : `${result.length} request${result.length > 1 ? 's' : ''} approved`,
        tone: failed ? 'info' : 'success',
      });
      load();
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Bulk approve failed', tone: 'error' });
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
              : `${list.length} regularization request${list.length > 1 ? 's' : ''} awaiting your decision.`}
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
          <EmptyState icon={Inbox} title="Inbox zero" description="No pending regularization requests." />
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
                <TH>Date</TH>
                <TH>Reason</TH>
                <TH>Requested In / Out</TH>
                <TH>Note</TH>
                <TH className="text-right">Decision</TH>
              </TR>
            </THead>
            <TBody>
              {list.map((r) => (
                <TR key={r.id}>
                  <TD>
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
                    <div className="text-xs text-muted-foreground">
                      {r.employee.department?.name ?? '—'}
                    </div>
                  </TD>
                  <TD>{fmtDate(r.targetDate)}</TD>
                  <TD>{REASON_LABELS[r.reasonType] ?? r.reasonType}</TD>
                  <TD className="tabular-nums">
                    {fmtTime(r.requestedCheckInAt)} – {fmtTime(r.requestedCheckOutAt)}
                  </TD>
                  <TD className="max-w-xs truncate text-xs text-muted-foreground">{r.note ?? '—'}</TD>
                  <TD>
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
    </div>
  );
}
