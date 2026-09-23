import * as React from 'react';
import { AlertTriangle, CalendarCheck, Info } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { UPLOAD_ACCEPT, uploadProblem } from '@/lib/documents';
import { LeaveMonthCalendar } from '@/pages/leave/components/leave-month-calendar';
import { dayLabel } from '@/pages/leave/shared';
import { leaveApi } from '@/lib/leave/client';
import { MOCK_CURRENT_YEAR } from '@/lib/leave/fixtures';
import { cn } from '@/lib/utils';
import type {
  Holiday,
  LeaveRequestPreview,
  LeaveType,
  TeamCalendarEntry,
} from '@/lib/leave/types';
import { useLeaveCtx } from '@/pages/leave/use-leave-ctx';

export function ApplyTab({ onApplied }: { onApplied: () => void }) {
  const ctx = useLeaveCtx();
  const { toast } = useToast();
  const [types, setTypes] = React.useState<LeaveType[]>([]);
  const [form, setForm] = React.useState({
    leaveTypeId: '',
    startDate: '',
    endDate: '',
    halfDay: false,
    reason: '',
  });
  const [file, setFile] = React.useState<File | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [preview, setPreview] = React.useState<LeaveRequestPreview | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [calMonth, setCalMonth] = React.useState(new Date());
  const [holidays, setHolidays] = React.useState<Holiday[]>([]);
  const [teamEntries, setTeamEntries] = React.useState<TeamCalendarEntry[]>([]);

  React.useEffect(() => {
    leaveApi.listTypes().then(setTypes);
  }, []);

  React.useEffect(() => {
    if (!ctx) return;
    const y = calMonth.getFullYear();
    const from = `${y}-${String(calMonth.getMonth() + 1).padStart(2, '0')}-01`;
    const to = `${y}-${String(calMonth.getMonth() + 1).padStart(2, '0')}-31`;
    leaveApi.listHolidays(y).then(setHolidays);
    leaveApi.teamCalendar(ctx, from, to).then(setTeamEntries);
  }, [ctx, calMonth]);

  // Recompute the balance-impact preview whenever the inputs settle.
  React.useEffect(() => {
    if (!ctx || !form.leaveTypeId || !form.startDate || !form.endDate) {
      setPreview(null);
      return;
    }
    if (form.endDate < form.startDate) {
      setPreview(null);
      setError('End date is before start date.');
      return;
    }
    setError(null);
    let cancelled = false;
    leaveApi
      .previewRequest(
        {
          leaveTypeId: form.leaveTypeId,
          startDate: form.startDate,
          endDate: form.endDate,
          halfDay: form.halfDay,
        },
        ctx.employeeId,
      )
      .then((p) => !cancelled && setPreview(p));
    return () => {
      cancelled = true;
    };
  }, [ctx, form.leaveTypeId, form.startDate, form.endDate, form.halfDay]);

  const selectedType = types.find((t) => t.id === form.leaveTypeId);
  const noticeShort =
    selectedType &&
    form.startDate &&
    (new Date(form.startDate + 'T00:00:00').getTime() - Date.now()) / 86_400_000 <
      selectedType.minNoticeDays;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ctx) return;
    const problem = file && uploadProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await leaveApi.createRequest(
        {
          leaveTypeId: form.leaveTypeId,
          startDate: form.startDate,
          endDate: form.endDate,
          halfDay: form.halfDay,
          reason: form.reason || undefined,
        },
        ctx,
      );
      toast({
        title: 'Leave request submitted',
        description: created.isLop
          ? `Flagged as Loss of Pay — ${dayLabel(created.days)} exceed your balance.`
          : `${dayLabel(created.days)} · routed to ${created.status === 'PENDING_L1' ? 'your manager' : 'HR'}.`,
        tone: created.isLop ? 'info' : 'success',
      });
      if (file) {
        // The request already exists at this point — an upload failure
        // must not read as "submit failed", so it gets its own toast.
        await leaveApi.attachToRequest(created.id, file).catch((err) =>
          toast({
            title: 'Request submitted, but the attachment failed',
            description: `${err instanceof Error ? err.message : 'Upload failed'} — attach it again from My Requests.`,
            tone: 'error',
          }),
        );
      }
      setForm({ leaveTypeId: '', startDate: '', endDate: '', halfDay: false, reason: '' });
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      setPreview(null);
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit request');
    } finally {
      setBusy(false);
    }
  }

  if (!ctx) {
    return <p className="text-sm text-muted-foreground">This account has no linked employee record.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,380px)_1fr]">
      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold">Request time off</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Leave type" required>
            <Select
              required
              value={form.leaveTypeId}
              onChange={(e) => setForm((f) => ({ ...f, leaveTypeId: e.target.value }))}
            >
              <option value="">Select…</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.code})
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date" required>
              <Input
                type="date"
                required
                value={form.startDate}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    startDate: e.target.value,
                    endDate: f.endDate && f.endDate < e.target.value ? e.target.value : f.endDate,
                  }))
                }
              />
            </Field>
            <Field label="End date" required>
              <Input
                type="date"
                required
                min={form.startDate || undefined}
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={form.halfDay}
              disabled={!!form.startDate && !!form.endDate && form.startDate !== form.endDate}
              onChange={(e) => setForm((f) => ({ ...f, halfDay: e.target.checked }))}
            />
            Half day
            <span className="text-xs text-muted-foreground">(single-day requests only)</span>
          </label>

          <Field label="Reason" hint={selectedType?.code === 'SL' ? 'A doctor’s note may be requested for 3+ days.' : undefined}>
            <Textarea
              rows={2}
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="Optional, but helps your approver."
            />
          </Field>

          <Field label="Supporting document" hint="Optional · PDF, JPG or PNG, up to 10 MB.">
            <Input
              ref={fileInput}
              type="file"
              accept={UPLOAD_ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>

          {preview && (
            <div className="rounded-md border border-border bg-muted/50 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Duration</span>
                <span className="font-medium">{dayLabel(preview.days)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-muted-foreground">Balance after</span>
                <span
                  className={cn(
                    'font-medium tabular-nums',
                    preview.availableAfter < 0 && 'text-destructive',
                  )}
                >
                  {preview.availableBefore % 1 === 0 ? preview.availableBefore : preview.availableBefore.toFixed(1)}
                  {' → '}
                  {preview.availableAfter % 1 === 0 ? preview.availableAfter : preview.availableAfter.toFixed(1)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-muted-foreground">First approver</span>
                <span className="font-medium">{preview.firstApprover ?? '—'}</span>
              </div>
              {preview.isLop && (
                <p className="mt-2 flex items-start gap-1.5 rounded bg-warning/10 p-2 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {dayLabel(preview.lopDays)} will be Loss of Pay — you can still submit, but those
                  days won’t be paid.
                </p>
              )}
            </div>
          )}

          {noticeShort && (
            <p className="flex items-start gap-1.5 text-xs text-warning">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {selectedType!.name} usually needs {selectedType!.minNoticeDays} days’ notice.
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" disabled={busy || !preview} className="self-start">
            <CalendarCheck className="h-4 w-4" />
            {busy ? 'Submitting…' : 'Submit request'}
          </Button>
        </form>
      </Card>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          Who’s already off — check for clashes before you submit.
        </p>
        <LeaveMonthCalendar
          month={calMonth}
          onMonthChange={setCalMonth}
          holidays={holidays}
          entries={teamEntries}
          highlight={
            form.startDate && form.endDate ? { start: form.startDate, end: form.endDate } : null
          }
        />
        <p className="text-xs text-muted-foreground">
          Showing {MOCK_CURRENT_YEAR} company holidays and your team’s approved &amp; pending leave.
        </p>
      </div>
    </div>
  );
}
