import * as React from 'react';
import { PencilLine, Users } from 'lucide-react';
import { api, isApiError } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';

interface RosterRow {
  employeeId: string;
  employeeName: string;
  department: string | null;
  record: { status: string; checkInAt: string | null; checkOutAt: string | null } | null;
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'outline'> = {
  PRESENT: 'success',
  LATE: 'warning',
  ON_LEAVE: 'outline',
  WEEKLY_OFF: 'outline',
  HOLIDAY: 'outline',
  ABSENT: 'destructive',
  PENDING_REGULARIZATION: 'warning',
};

const MARK_STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'HOLIDAY', 'WEEKLY_OFF', 'ON_LEAVE'] as const;

function fmtTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Team roster for one day — a Line Manager's recursive subtree, or
 *  everyone for HR/Admin. `canMark` (Company Admin/HR Manager only) adds a
 *  manual-mark action per row, FR-ATT-001. */
export function AttendanceTeamTab({ canMark }: { canMark: boolean }) {
  const { toast } = useToast();
  const [date, setDate] = React.useState(todayIso());
  const [rows, setRows] = React.useState<RosterRow[] | null>(null);
  const [markTarget, setMarkTarget] = React.useState<RosterRow | null>(null);

  const load = React.useCallback(() => {
    setRows(null);
    api.get<RosterRow[]>(`/attendance/team/roster?date=${date}`).then(setRows);
  }, [date]);
  React.useEffect(load, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Label htmlFor="roster-date">Date</Label>
        <Input
          id="roster-date"
          type="date"
          className="w-44"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      <Card className="overflow-hidden">
        {rows == null ? (
          <div className="p-4">
            <SkeletonRows rows={6} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Users} title="No reports" description="Nobody currently reports to you." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Status</TH>
                <TH>Clock In</TH>
                <TH>Clock Out</TH>
                {canMark && <TH className="text-right">Actions</TH>}
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.employeeId}>
                  <TD>
                    <div className="font-medium">{r.employeeName}</div>
                    <div className="text-xs text-muted-foreground">{r.department ?? '—'}</div>
                  </TD>
                  <TD>
                    {r.record ? (
                      <Badge variant={STATUS_VARIANT[r.record.status] ?? 'outline'}>
                        {r.record.status.replace(/_/g, ' ')}
                      </Badge>
                    ) : (
                      <Badge variant="outline">Unmarked</Badge>
                    )}
                  </TD>
                  <TD className="tabular-nums">{fmtTime(r.record?.checkInAt ?? null)}</TD>
                  <TD className="tabular-nums">{fmtTime(r.record?.checkOutAt ?? null)}</TD>
                  {canMark && (
                    <TD className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setMarkTarget(r)}>
                        <PencilLine className="h-3.5 w-3.5" /> Mark
                      </Button>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <MarkAttendanceDialog
        target={markTarget}
        date={date}
        open={markTarget != null}
        onOpenChange={(v) => !v && setMarkTarget(null)}
        onSaved={() => {
          setMarkTarget(null);
          load();
          toast({ title: 'Attendance marked', tone: 'success' });
        }}
      />
    </div>
  );
}

function MarkAttendanceDialog({
  target,
  date,
  open,
  onOpenChange,
  onSaved,
}: {
  target: RosterRow | null;
  date: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = React.useState<(typeof MARK_STATUSES)[number]>('PRESENT');
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setStatus('PRESENT');
      setReason('');
      setError(null);
    }
  }, [open]);

  if (!target) return null;

  async function submit() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/attendance/mark', {
        employeeId: target.employeeId,
        date,
        status,
        reason: reason.trim(),
      });
      onSaved();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader title={`Mark attendance — ${target.employeeName}`} onClose={() => onOpenChange(false)} />
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Status</Label>
            <Select value={status} onChange={(e) => setStatus(e.target.value as any)}>
              {MARK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Reason (logged)</Label>
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. On-site client visit, confirmed with manager."
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy || reason.trim().length < 5}>
              {busy ? '…' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
