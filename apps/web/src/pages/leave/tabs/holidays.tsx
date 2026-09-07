import * as React from 'react';
import { CalendarPlus, PartyPopper, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { fmtDate } from '@/pages/leave/shared';
import { leaveApi } from '@/lib/leave/client';
import { MOCK_CURRENT_YEAR } from '@/lib/leave/fixtures';
import type { Holiday } from '@/lib/leave/types';

/**
 * Company holiday calendar. Read-only for employees; `canManage` unlocks
 * add/delete for HR / Company Admin. Shared by Leave and (later) Attendance —
 * both modules count these as non-working days.
 */
export function HolidaysTab({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const [year, setYear] = React.useState(MOCK_CURRENT_YEAR);
  const [rows, setRows] = React.useState<Holiday[] | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);

  const load = React.useCallback(() => {
    setRows(null);
    leaveApi.listHolidays(year).then(setRows);
  }, [year]);
  React.useEffect(load, [load]);

  const todayIso = new Date().toISOString().slice(0, 10);

  async function remove(h: Holiday) {
    await leaveApi.deleteHoliday(h.id);
    toast({ title: `Removed “${h.name}”`, tone: 'info' });
    load();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setYear((y) => y - 1)}>
            ‹ {year - 1}
          </Button>
          <span className="text-sm font-semibold">{year}</span>
          <Button variant="outline" size="sm" onClick={() => setYear((y) => y + 1)}>
            {year + 1} ›
          </Button>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <CalendarPlus className="h-4 w-4" /> Add holiday
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        {!rows ? (
          <div className="p-4">
            <SkeletonRows rows={6} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={PartyPopper}
            title={`No holidays defined for ${year}`}
            description={canManage ? 'Add them so leave and attendance skip these days.' : undefined}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Day</TH>
                <TH>Holiday</TH>
                <TH>Type</TH>
                {canManage && <TH className="text-right">Actions</TH>}
              </TR>
            </THead>
            <TBody>
              {rows.map((h) => (
                <TR key={h.id} className={h.date < todayIso ? 'text-muted-foreground' : undefined}>
                  <TD className="tabular-nums">{fmtDate(h.date)}</TD>
                  <TD>
                    {new Date(h.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' })}
                  </TD>
                  <TD className="font-medium text-foreground">{h.name}</TD>
                  <TD>
                    <Badge variant={h.optional ? 'outline' : 'default'}>
                      {h.optional ? 'Optional' : 'Gazetted'}
                    </Badge>
                  </TD>
                  {canManage && (
                    <TD className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(h)}
                        aria-label={`Remove ${h.name}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {canManage && (
        <AddHolidayDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          year={year}
          onAdded={() => {
            setAddOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function AddHolidayDialog({
  open,
  onOpenChange,
  year,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  year: number;
  onAdded: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = React.useState({ date: '', name: '', optional: false });
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) setForm({ date: '', name: '', optional: false });
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await leaveApi.createHoliday({ date: form.date, name: form.name, optional: form.optional });
      toast({ title: `Added “${form.name}”` });
      onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title="Add company holiday"
          description={`Applies to the ${year} calendar.`}
          onClose={() => onOpenChange(false)}
        />
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Date" required>
            <Input
              type="date"
              required
              min={`${year}-01-01`}
              max={`${year}-12-31`}
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
          </Field>
          <Field label="Name" required>
            <Input
              required
              placeholder="e.g. Diwali"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={form.optional}
              onChange={(e) => setForm((f) => ({ ...f, optional: e.target.checked }))}
            />
            Optional / restricted holiday
          </label>
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Adding…' : 'Add holiday'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
