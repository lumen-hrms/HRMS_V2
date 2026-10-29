import * as React from 'react';
import { Pencil, PlusCircle, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { leaveApi } from '@/lib/leave/client';
import { MOCK_CURRENT_YEAR } from '@/lib/leave/fixtures';
import { ACCRUAL_LABELS, type AccrualFrequency, type LeaveType } from '@/lib/leave/types';
import { EVENT_PRESETS, describeEventType } from '@/lib/leave/event-presets';

const ACCRUAL_PALETTE = ['#2b5a8c', '#1a7f5a', '#a8681a', '#7c4fb0', '#0f766e', '#b3261e'];

function deriveCode(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return initials.slice(0, 3) || 'LT';
}

/**
 * Leave type configuration. The form exposes name / annual quota /
 * carry-forward cap / accrual frequency / requires-approval / comp-off flag;
 * the rest of the frontend LeaveType shape (code, colorToken,
 * genderRestriction, minNoticeDays, ...) gets sensible auto-derived
 * defaults so `createType`'s full-shape signature is still satisfied,
 * without building UI for every field yet (see docs/LEAVE_UI_SPECS.md).
 */
export function LeaveTypesTab({ readOnly = false }: { readOnly?: boolean }) {
  const [rows, setRows] = React.useState<LeaveType[] | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LeaveType | null>(null);
  const [initializing, setInitializing] = React.useState<LeaveType | null>(null);

  const load = React.useCallback(() => {
    setRows(null);
    leaveApi.listTypes(true).then(setRows);
  }, []);
  React.useEffect(load, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Quotas, carry-forward caps, and accrual schedules for every leave type.
        </p>
        {!readOnly && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <PlusCircle className="h-4 w-4" /> Add type
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        {!rows ? (
          <div className="p-4">
            <SkeletonRows rows={5} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="No leave types defined yet" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH className="text-right">Annual quota</TH>
                <TH className="text-right">Carry-forward cap</TH>
                <TH>Accrual</TH>
                <TH>Approval</TH>
                {!readOnly && <TH className="text-right">Actions</TH>}
              </TR>
            </THead>
            <TBody>
              {rows.map((t) => (
                <TR key={t.id}>
                  <TD className="font-medium text-foreground">
                    {t.name}
                    {t.genderRestriction !== 'ANY' && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        · {t.genderRestriction === 'FEMALE' ? 'women' : 'men'} only
                      </span>
                    )}
                  </TD>
                  {t.grantMode === 'ON_EVENT' ? (
                    <TD colSpan={2} className="text-right text-xs text-muted-foreground">
                      {describeEventType(t)}
                    </TD>
                  ) : (
                    <>
                      <TD className="text-right tabular-nums">{t.annualQuota}d</TD>
                      <TD className="text-right tabular-nums">{t.carryForwardCap}d</TD>
                    </>
                  )}
                  <TD>
                    <Badge variant="outline">
                      {t.grantMode === 'ON_EVENT' ? 'Per event' : ACCRUAL_LABELS[t.accrualFrequency]}
                    </Badge>
                  </TD>
                  <TD>
                    <Badge variant={t.requiresApproval ? 'default' : 'outline'}>
                      {t.requiresApproval ? 'Requires approval' : 'Auto-approved'}
                    </Badge>
                  </TD>
                  {!readOnly && (
                    <TD className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={t.grantMode === 'ON_EVENT'}
                          onClick={() => setInitializing(t)}
                          aria-label={`Initialize balances for ${t.name}`}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(t)}
                          aria-label={`Edit ${t.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {!readOnly && (
        <>
          <TypeFormDialog
            mode="create"
            open={addOpen}
            onOpenChange={setAddOpen}
            onSaved={() => {
              setAddOpen(false);
              load();
            }}
          />
          <TypeFormDialog
            mode="edit"
            open={!!editing}
            initial={editing ?? undefined}
            onOpenChange={(v) => !v && setEditing(null)}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
          <InitializeYearDialog
            type={initializing}
            onOpenChange={(v) => !v && setInitializing(null)}
            onDone={() => setInitializing(null)}
          />
        </>
      )}
    </div>
  );
}

type TypeForm = Omit<LeaveType, 'id' | 'active' | 'colorToken'> & { grantMode: 'ACCRUED' | 'ON_EVENT' };

const BLANK_FORM: TypeForm = {
  name: '',
  code: '',
  annualQuota: 12,
  carryForwardCap: 0,
  accrualFrequency: 'ANNUAL',
  genderRestriction: 'ANY',
  minNoticeDays: 0,
  paid: true,
  requiresApproval: true,
  isCompOff: false,
  isRestrictedHoliday: false,
  grantMode: 'ACCRUED',
  daysPerEvent: null,
  reducedDaysPerEvent: null,
  reducedAfterEvents: null,
  countCalendarDays: false,
  maxEventsPerEmployment: null,
  eventLabel: '',
  eventWindowDaysBefore: 0,
  eventWindowDaysAfter: 0,
  minServiceDays: 0,
  requiresDocument: false,
  statutoryMaternity: false,
};

const optNum = (v: string) => (v === '' ? null : Number(v));

function TypeFormDialog({
  mode,
  open,
  initial,
  onOpenChange,
  onSaved,
}: {
  mode: 'create' | 'edit';
  open: boolean;
  initial?: LeaveType;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = React.useState<TypeForm>(BLANK_FORM);
  const [busy, setBusy] = React.useState(false);
  const set = <K extends keyof TypeForm>(k: K, v: TypeForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  React.useEffect(() => {
    if (!open) return;
    setForm(initial ? { ...BLANK_FORM, ...initial, grantMode: initial.grantMode ?? 'ACCRUED' } : BLANK_FORM);
  }, [open, initial]);

  const onEvent = form.grantMode === 'ON_EVENT';

  function applyPreset(code: string) {
    const preset = EVENT_PRESETS.find((p) => p.code === code);
    if (!preset) return;
    const { summary: _summary, ...fields } = preset;
    void _summary;
    setForm((f) => ({ ...f, ...fields, grantMode: 'ON_EVENT', annualQuota: 0, carryForwardCap: 0 }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { code: rawCode, ...rest } = form;
    const payload = {
      ...rest,
      eventLabel: onEvent ? form.eventLabel : null,
      ...(onEvent ? { annualQuota: 0, carryForwardCap: 0 } : {}),
    };
    try {
      if (mode === 'create') {
        await leaveApi.createType({
          ...payload,
          code: rawCode.trim() ? rawCode.trim().toUpperCase() : deriveCode(form.name),
          colorToken: ACCRUAL_PALETTE[Math.floor(Math.random() * ACCRUAL_PALETTE.length)],
          active: true,
        });
        toast({ title: `Added “${form.name}”` });
      } else if (initial) {
        await leaveApi.updateType(initial.id, { ...payload, code: rawCode.trim().toUpperCase() || initial.code });
        toast({ title: `Updated “${form.name}”` });
      }
      onSaved();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not save the leave type', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const check = (k: keyof TypeForm, label: React.ReactNode, hint?: string, disabled?: boolean) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-input"
        checked={!!form[k]}
        disabled={disabled}
        onChange={(e) => set(k, e.target.checked as TypeForm[typeof k])}
      />
      {label}
      {hint && <span className="text-xs text-muted-foreground">({hint})</span>}
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader
          title={mode === 'create' ? 'Add leave type' : `Edit ${initial?.name ?? ''}`}
          description={
            onEvent
              ? 'Event-based: no yearly balance. Each request names its event (a delivery, a birth, a marriage) and is granted that event’s days.'
              : 'Balances follow this policy automatically: the nightly job credits each period as it starts.'
          }
          onClose={() => onOpenChange(false)}
        />
        <form onSubmit={submit} className="flex flex-col gap-3">
          {mode === 'create' && (
            <Field label="Start from a ready-made type" hint="Optional — fills in the rules below; everything stays editable.">
              <Select value="" onChange={(e) => applyPreset(e.target.value)}>
                <option value="">Choose…</option>
                {EVENT_PRESETS.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name} — {p.summary}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Name" required className="col-span-2">
              <Input required placeholder="e.g. Earned Leave" value={form.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Code" hint="Blank = from the name">
              <Input value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="How it’s given">
              <Select value={form.grantMode} onChange={(e) => set('grantMode', e.target.value as TypeForm['grantMode'])}>
                <option value="ACCRUED">Yearly / periodic balance</option>
                <option value="ON_EVENT">Per life event (maternity, marriage…)</option>
              </Select>
            </Field>
            <Field label="Who can take it">
              <Select
                value={form.genderRestriction}
                onChange={(e) => set('genderRestriction', e.target.value as TypeForm['genderRestriction'])}
              >
                <option value="ANY">Everyone</option>
                <option value="FEMALE">Women only</option>
                <option value="MALE">Men only</option>
              </Select>
            </Field>
          </div>

          {onEvent ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Event the employee enters" required>
                <Input value={form.eventLabel ?? ''} placeholder="e.g. Marriage date" onChange={(e) => set('eventLabel', e.target.value)} />
              </Field>
              <Field label="Days per event" required>
                <Input type="number" min={0} step="0.5" required value={form.daysPerEvent ?? ''} onChange={(e) => set('daysPerEvent', optNum(e.target.value))} />
              </Field>
              <Field label="Can start up to (days before)">
                <Input type="number" min={0} value={form.eventWindowDaysBefore ?? 0} onChange={(e) => set('eventWindowDaysBefore', Number(e.target.value))} />
              </Field>
              <Field label="Must start within (days after)">
                <Input type="number" min={0} value={form.eventWindowDaysAfter ?? 0} onChange={(e) => set('eventWindowDaysAfter', Number(e.target.value))} />
              </Field>
              <Field label="Times per employment" hint="Blank = no limit">
                <Input type="number" min={1} value={form.maxEventsPerEmployment ?? ''} onChange={(e) => set('maxEventsPerEmployment', optNum(e.target.value))} />
              </Field>
              <Field label="Service needed (days in prior 12 months)">
                <Input type="number" min={0} value={form.minServiceDays ?? 0} onChange={(e) => set('minServiceDays', Number(e.target.value))} />
              </Field>
              <Field label="Reduced days" hint="e.g. 84 from the 3rd child">
                <Input type="number" min={0} value={form.reducedDaysPerEvent ?? ''} onChange={(e) => set('reducedDaysPerEvent', optNum(e.target.value))} />
              </Field>
              <Field label="…after this many events">
                <Input type="number" min={0} value={form.reducedAfterEvents ?? ''} onChange={(e) => set('reducedAfterEvents', optNum(e.target.value))} />
              </Field>
              <div className="col-span-2 flex flex-col gap-2">
                {check('countCalendarDays', 'Count calendar days', 'weekends and holidays included — maternity')}
                {check('requiresDocument', 'Needs a supporting document before final approval')}
                {check('statutoryMaternity', 'Statutory maternity-type leave', 'flags ESI-covered employees — ESIC pays the benefit')}
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Annual quota (days)" required>
                  <Input type="number" min={0} step="0.5" required value={form.annualQuota} onChange={(e) => set('annualQuota', Number(e.target.value))} />
                </Field>
                <Field label="Carry-forward cap (days)">
                  <Input type="number" min={0} step="0.5" value={form.carryForwardCap} onChange={(e) => set('carryForwardCap', Number(e.target.value))} />
                </Field>
              </div>
              <Field label="Accrual frequency">
                <Select value={form.accrualFrequency} onChange={(e) => set('accrualFrequency', e.target.value as AccrualFrequency)}>
                  {Object.entries(ACCRUAL_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              {check('isCompOff', 'This is the comp-off type', 'earned automatically for holiday/weekly-off work, not applied for', form.isRestrictedHoliday)}
              {check('isRestrictedHoliday', 'Restricted holiday', 'can only be taken on an optional holiday', form.isCompOff)}
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Notice (days)">
              <Input type="number" min={0} value={form.minNoticeDays} onChange={(e) => set('minNoticeDays', Number(e.target.value))} />
            </Field>
            <div className="flex flex-col justify-end gap-2 pb-1">
              {check('paid', 'Paid')}
              {check('requiresApproval', 'Requires approval')}
            </div>
          </div>
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : mode === 'create' ? 'Add type' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InitializeYearDialog({
  type,
  onOpenChange,
  onDone,
}: {
  type: LeaveType | null;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [year, setYear] = React.useState(MOCK_CURRENT_YEAR);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (type) setYear(MOCK_CURRENT_YEAR);
  }, [type]);

  if (!type) return null;

  async function run() {
    setBusy(true);
    try {
      const { initialized, credited } = await leaveApi.initializeBalances(type!.id, year);
      toast({
        title: `Applied ${type!.name} for ${year}`,
        description: `${credited} credit${credited === 1 ? '' : 's'}, ${initialized} new balance${initialized === 1 ? '' : 's'}.`,
      });
      onDone();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not apply the policy', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!type} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={`Apply ${type.name} now`}
          description="Credits everyone what this policy owes for the current leave year and hasn't been credited yet (prorated for joiners and your go-live date). The nightly job does this anyway — this just doesn't wait. Safe to run twice."
          onClose={() => onOpenChange(false)}
        />
        <div className="flex flex-col gap-3">
          <Field label="Leave year" required hint="The current leave year only.">
            <Input
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </Field>
          <div className="mt-1 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={run} disabled={busy}>
              {busy ? 'Applying…' : 'Apply now'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
