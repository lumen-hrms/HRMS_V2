import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api, isApiError } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';

interface Shift {
  id: string;
  name: string;
  type: 'FIXED' | 'FLEXI' | 'ROTATIONAL';
  startTime: string;
  endTime: string;
  graceMinutes: number;
  minHoursFullDay: string;
  minHoursHalfDay: string;
  coreStartTime: string | null;
  coreEndTime: string | null;
  isDefault: boolean;
}

interface AttendanceConfig {
  mode: 'SELF_SERVICE' | 'ROSTER' | 'OFF';
  captureMethods: string[];
  regularizationWindowDays: number;
  regularizationMonthlyCap: number;
  unactionedBehavior: 'AUTO_APPROVE' | 'AUTO_REJECT';
  timezone: string;
  weeklyOffDays: number[];
  payrollCutoffDay: number;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CAPTURE_METHODS = ['WEB', 'BIOMETRIC', 'GPS', 'IMPORT', 'MANUAL'] as const;

interface ShiftForm {
  name: string;
  type: 'FIXED' | 'FLEXI' | 'ROTATIONAL';
  startTime: string;
  endTime: string;
  graceMinutes: number;
  minHoursFullDay: number;
  minHoursHalfDay: number;
  isDefault: boolean;
}

const emptyShift: ShiftForm = {
  name: '',
  type: 'FIXED',
  startTime: '09:00',
  endTime: '18:00',
  graceMinutes: 15,
  minHoursFullDay: 8,
  minHoursHalfDay: 4,
  isDefault: false,
};

/**
 * docs/TENANT_CONFIGURATION.md layer 2 — the "engine wiring" + Settings UI
 * this module was still missing: shift catalogue CRUD, and the general
 * (non-Leave-specific) slice of `tenant_settings` plus `attendance_settings`.
 * `SettingsTab` in the Leave module owns `leaveApprovalLevels` /
 * `leaveEscalationDays` / `allowLopRequests` / `fyStartMonth` — deliberately
 * not duplicated here.
 */
export function AttendanceSettingsTab() {
  const { toast } = useToast();
  const [shifts, setShifts] = React.useState<Shift[] | null>(null);
  const [config, setConfig] = React.useState<AttendanceConfig | null>(null);
  const [shiftDialog, setShiftDialog] = React.useState<Shift | 'new' | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    api.get<Shift[]>('/attendance/shifts').then(setShifts);
    api.get<AttendanceConfig>('/attendance/settings').then(setConfig);
  }, []);
  React.useEffect(load, [load]);

  async function deleteShift(shift: Shift) {
    try {
      await api.delete(`/attendance/shifts/${shift.id}`);
      toast({ title: `Removed “${shift.name}”`, tone: 'info' });
      load();
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Could not delete shift', tone: 'error' });
    }
  }

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!config) return;
    setBusy(true);
    try {
      const updated = await api.patch<AttendanceConfig>('/attendance/settings', config);
      setConfig(updated);
      toast({ title: 'Settings saved', tone: 'success' });
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Save failed', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h3 className="text-sm font-semibold">Shifts</h3>
            <p className="text-xs text-muted-foreground">
              The <code>isDefault</code> shift is the fallback for any employee with no explicit
              override.
            </p>
          </div>
          <Button size="sm" onClick={() => setShiftDialog('new')}>
            <Plus className="h-4 w-4" /> Add shift
          </Button>
        </div>
        {!shifts ? (
          <div className="p-4">
            <SkeletonRows rows={3} />
          </div>
        ) : shifts.length === 0 ? (
          <EmptyState title="No shifts configured" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Type</TH>
                <TH>Hours</TH>
                <TH>Grace</TH>
                <TH>Min full / half day</TH>
                <TH></TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {shifts.map((s) => (
                <TR key={s.id}>
                  <TD className="font-medium">{s.name}</TD>
                  <TD>{s.type}</TD>
                  <TD className="tabular-nums">
                    {s.startTime}–{s.endTime}
                  </TD>
                  <TD className="tabular-nums">{s.graceMinutes}m</TD>
                  <TD className="tabular-nums">
                    {s.minHoursFullDay}h / {s.minHoursHalfDay}h
                  </TD>
                  <TD>{s.isDefault && <Badge variant="success">Default</Badge>}</TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => setShiftDialog(s)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={s.isDefault}
                        title={s.isDefault ? 'Set another shift as default first' : undefined}
                        onClick={() => deleteShift(s)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card className="max-w-2xl p-4">
        <h3 className="mb-4 text-sm font-semibold">Attendance &amp; general settings</h3>
        {!config ? (
          <SkeletonRows rows={4} />
        ) : (
          <form onSubmit={saveConfig} className="flex flex-col gap-4">
            <Field
              label="Mode"
              hint="Self-service shows the web clock-in button; roster hides it in favour of assigned shifts/device punches; off is leave-only."
            >
              <Select
                value={config.mode}
                onChange={(e) => setConfig((c) => (c ? { ...c, mode: e.target.value as any } : c))}
              >
                <option value="SELF_SERVICE">Self-service (web clock-in)</option>
                <option value="ROSTER">Roster (device / import punches)</option>
                <option value="OFF">Off (leave-only)</option>
              </Select>
            </Field>

            <Field label="Accepted capture methods">
              <div className="flex flex-wrap gap-3">
                {CAPTURE_METHODS.map((m) => (
                  <label key={m} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input"
                      checked={config.captureMethods.includes(m)}
                      onChange={(e) =>
                        setConfig((c) =>
                          c
                            ? {
                                ...c,
                                captureMethods: e.target.checked
                                  ? [...c.captureMethods, m]
                                  : c.captureMethods.filter((x) => x !== m),
                              }
                            : c,
                        )
                      }
                    />
                    {m}
                  </label>
                ))}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Regularization window (days)">
                <Input
                  type="number"
                  min={1}
                  value={config.regularizationWindowDays}
                  onChange={(e) =>
                    setConfig((c) => (c ? { ...c, regularizationWindowDays: Number(e.target.value) } : c))
                  }
                />
              </Field>
              <Field label="Regularization monthly cap">
                <Input
                  type="number"
                  min={1}
                  value={config.regularizationMonthlyCap}
                  onChange={(e) =>
                    setConfig((c) => (c ? { ...c, regularizationMonthlyCap: Number(e.target.value) } : c))
                  }
                />
              </Field>
            </div>

            <Field
              label="Unactioned regularization at payroll cut-off"
              hint="What happens to a request a manager never decided by the payroll deadline."
            >
              <Select
                value={config.unactionedBehavior}
                onChange={(e) =>
                  setConfig((c) => (c ? { ...c, unactionedBehavior: e.target.value as any } : c))
                }
              >
                <option value="AUTO_APPROVE">Auto-approve (lenient)</option>
                <option value="AUTO_REJECT">Auto-reject (strict)</option>
              </Select>
            </Field>

            <Field label="Timezone" hint="IANA zone — wall-clock shift times and 'today' boundaries resolve against this.">
              <Input
                value={config.timezone}
                onChange={(e) => setConfig((c) => (c ? { ...c, timezone: e.target.value } : c))}
              />
            </Field>

            <Field label="Weekly off days">
              <div className="flex flex-wrap gap-3">
                {DAY_LABELS.map((label, day) => (
                  <label key={day} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input"
                      checked={config.weeklyOffDays.includes(day)}
                      onChange={(e) =>
                        setConfig((c) =>
                          c
                            ? {
                                ...c,
                                weeklyOffDays: e.target.checked
                                  ? [...c.weeklyOffDays, day]
                                  : c.weeklyOffDays.filter((d) => d !== day),
                              }
                            : c,
                        )
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </Field>

            <Field label="Payroll cut-off day" hint="Day of month the payroll period locks.">
              <Input
                type="number"
                min={1}
                max={28}
                value={config.payrollCutoffDay}
                onChange={(e) => setConfig((c) => (c ? { ...c, payrollCutoffDay: Number(e.target.value) } : c))}
              />
            </Field>

            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        )}
      </Card>

      <ShiftDialog
        shift={shiftDialog}
        open={shiftDialog != null}
        onOpenChange={(v) => !v && setShiftDialog(null)}
        onSaved={load}
      />
    </div>
  );
}

function ShiftDialog({
  shift,
  open,
  onOpenChange,
  onSaved,
}: {
  shift: Shift | 'new' | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = React.useState<ShiftForm>(emptyShift);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const isNew = shift === 'new';

  React.useEffect(() => {
    if (!open) return;
    if (shift && shift !== 'new') {
      setForm({
        name: shift.name,
        type: shift.type,
        startTime: shift.startTime,
        endTime: shift.endTime,
        graceMinutes: shift.graceMinutes,
        minHoursFullDay: Number(shift.minHoursFullDay),
        minHoursHalfDay: Number(shift.minHoursHalfDay),
        isDefault: shift.isDefault,
      });
    } else {
      setForm(emptyShift);
    }
    setError(null);
  }, [shift, open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isNew) {
        await api.post('/attendance/shifts', form);
      } else if (shift) {
        await api.patch(`/attendance/shifts/${shift.id}`, form);
      }
      toast({ title: isNew ? 'Shift created' : 'Shift updated', tone: 'success' });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  if (!shift) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={isNew ? 'Add shift' : `Edit ${(shift as Shift).name}`}
          onClose={() => onOpenChange(false)}
        />
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Type</Label>
            <Select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as any }))}
            >
              <option value="FIXED">Fixed</option>
              <option value="FLEXI">Flexi</option>
              <option value="ROTATIONAL">Rotational</option>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Start time</Label>
              <Input
                type="time"
                required
                value={form.startTime}
                onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>End time</Label>
              <Input
                type="time"
                required
                value={form.endTime}
                onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Grace (min)</Label>
              <Input
                type="number"
                min={0}
                value={form.graceMinutes}
                onChange={(e) => setForm((f) => ({ ...f, graceMinutes: Number(e.target.value) }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Min full-day (h)</Label>
              <Input
                type="number"
                min={0}
                step="0.5"
                value={form.minHoursFullDay}
                onChange={(e) => setForm((f) => ({ ...f, minHoursFullDay: Number(e.target.value) }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Min half-day (h)</Label>
              <Input
                type="number"
                min={0}
                step="0.5"
                value={form.minHoursHalfDay}
                onChange={(e) => setForm((f) => ({ ...f, minHoursHalfDay: Number(e.target.value) }))}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={form.isDefault}
              onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
            />
            Default shift (fallback for employees with no override)
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
