import * as React from 'react';
import { Wallet } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { fmtDate } from '@/pages/leave/shared';
import { leaveApi } from '@/lib/leave/client';
import { MOCK_CURRENT_YEAR } from '@/lib/leave/fixtures';
import type { LeaveLedgerEntry, LeaveType } from '@/lib/leave/types';
import { useLeaveCtx } from '@/pages/leave/use-leave-ctx';

/**
 * HR-only manual balance correction (e.g. a data-migration fix, a goodwill
 * credit). Every adjustment writes a `LeaveLedgerEntry` with
 * source `HR_ADJUSTMENT` — this screen's history table and the Ledger tab
 * both read the same records.
 */
export function BalanceAdjustmentsTab() {
  const ctx = useLeaveCtx();
  const { toast } = useToast();
  const [people, setPeople] = React.useState<{ id: string; name: string; department: string }[]>([]);
  const [types, setTypes] = React.useState<LeaveType[]>([]);
  const [history, setHistory] = React.useState<LeaveLedgerEntry[] | null>(null);
  const [form, setForm] = React.useState({
    employeeId: '',
    leaveTypeId: '',
    year: MOCK_CURRENT_YEAR,
    delta: 0,
    note: '',
  });
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    leaveApi.people().then(setPeople);
    leaveApi.listTypes().then(setTypes);
  }, []);

  const loadHistory = React.useCallback(() => {
    setHistory(null);
    leaveApi.ledger({}).then((rows) => setHistory(rows.filter((r) => r.source === 'HR_ADJUSTMENT')));
  }, []);
  React.useEffect(loadHistory, [loadHistory]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ctx || !form.employeeId || !form.leaveTypeId || !form.note.trim()) return;
    setBusy(true);
    try {
      await leaveApi.adjustBalance(
        {
          employeeId: form.employeeId,
          leaveTypeId: form.leaveTypeId,
          year: form.year,
          delta: form.delta,
          note: form.note,
        },
        ctx,
      );
      toast({ title: 'Balance adjusted', tone: 'success' });
      setForm((f) => ({ ...f, delta: 0, note: '' }));
      loadHistory();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">New adjustment</h3>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Field label="Employee" required>
            <Select
              required
              value={form.employeeId}
              onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}
            >
              <option value="">Select…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Leave type" required>
            <Select
              required
              value={form.leaveTypeId}
              onChange={(e) => setForm((f) => ({ ...f, leaveTypeId: e.target.value }))}
            >
              <option value="">Select…</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Year" required>
            <Input
              type="number"
              required
              value={form.year}
              onChange={(e) => setForm((f) => ({ ...f, year: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Delta (days)" hint="Positive to credit, negative to debit" required>
            <Input
              type="number"
              step="0.5"
              required
              value={form.delta}
              onChange={(e) => setForm((f) => ({ ...f, delta: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Note" required>
            <Input
              required
              placeholder="Reason for the adjustment"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            />
          </Field>
          <div className="col-span-2 flex justify-end md:col-span-5">
            <Button type="submit" disabled={busy}>
              {busy ? 'Applying…' : 'Apply adjustment'}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden">
        {!history ? (
          <div className="p-4">
            <SkeletonRows rows={5} />
          </div>
        ) : history.length === 0 ? (
          <EmptyState icon={Wallet} title="No manual adjustments yet" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Employee</TH>
                <TH>Type</TH>
                <TH className="text-right">Delta</TH>
                <TH className="text-right">Balance after</TH>
                <TH>Note</TH>
                <TH>By</TH>
              </TR>
            </THead>
            <TBody>
              {history.map((h) => (
                <TR key={h.id}>
                  <TD className="text-muted-foreground">{fmtDate(h.at)}</TD>
                  <TD className="font-medium text-foreground">{h.employeeName}</TD>
                  <TD>{h.leaveTypeCode}</TD>
                  <TD className={`text-right tabular-nums ${h.delta >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {h.delta >= 0 ? '+' : ''}
                    {h.delta}d
                  </TD>
                  <TD className="text-right tabular-nums">{h.balanceAfter}d</TD>
                  <TD className="text-muted-foreground">{h.note ?? '—'}</TD>
                  <TD className="text-muted-foreground">{h.actorName}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
