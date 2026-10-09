import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isApiError } from '@/lib/api';
import * as payroll from '@/lib/payroll/client';
import type { AdHocAdjustment } from '@/lib/payroll/types';
import { useToast } from '@/components/ui/toast';

export function AdjustmentsDialog({
  runId,
  employeeId,
  initial,
  open,
  onOpenChange,
  onSaved,
}: {
  runId: string;
  employeeId: string | null;
  initial: AdHocAdjustment[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<AdHocAdjustment[]>(initial);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) setRows(initial);
  }, [open, initial]);

  if (!employeeId) return null;
  const empId = employeeId;

  function update(i: number, patch: Partial<AdHocAdjustment>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function submit() {
    setBusy(true);
    try {
      await payroll.setLineItemAdjustments(runId, empId, rows);
      toast({ title: 'Adjustments saved', tone: 'success' });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Save failed', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader title="Ad-hoc adjustments" onClose={() => onOpenChange(false)} />
        <p className="mb-3 text-xs text-muted-foreground">
          Signed amounts — positive adds to net pay (bonus/incentive), negative subtracts
          (advance/recovery). Saving replaces the whole list, including any arrears already
          folded in here.
        </p>
        <div className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                placeholder="TYPE"
                value={row.type}
                onChange={(e) => update(i, { type: e.target.value.toUpperCase() })}
                className="w-32"
              />
              <Input
                type="number"
                placeholder="Amount"
                value={row.amount}
                onChange={(e) => update(i, { amount: Number(e.target.value) })}
                className="w-28"
              />
              <Input
                placeholder="Note (optional)"
                value={row.note ?? ''}
                onChange={(e) => update(i, { note: e.target.value })}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 self-start"
          onClick={() => setRows((r) => [...r, { type: 'BONUS', amount: 0 }])}
        >
          <Plus className="h-4 w-4" /> Add adjustment
        </Button>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={submit}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

