import * as React from 'react';
import { Check } from 'lucide-react';
import { api } from '@/lib/api';
import { leaveApi } from '@/lib/leave/client';
import type { Holiday, LeaveType } from '@/lib/leave/types';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { useAuth } from '@/context/auth-context';
import { cn } from '@/lib/utils';

interface WizardState {
  status: 'PENDING' | 'IN_PROGRESS' | 'DISMISSED' | 'COMPLETED';
  step: number;
}

interface AttendanceConfig {
  mode: string;
  captureMethods: string[];
  regularizationWindowDays: number;
  regularizationMonthlyCap: number;
  unactionedBehavior: string;
  timezone: string;
  weeklyOffDays: number[];
  payrollCutoffDay: number;
}

interface Shift {
  id: string;
  name: string;
  type: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  minHoursFullDay: string | number;
  minHoursHalfDay: string | number;
  isDefault: boolean;
}

/** A step registers its "commit pending edits" callback here; the parent
 *  calls it right before advancing/going back/skipping, never on every
 *  keystroke — avoids a PATCH storm while someone's still typing. */
type RegisterSave = (fn: () => Promise<void> | void) => void;

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STEP_LABELS = ['Work week', 'Default shift', 'Holidays', 'Leave types', 'Payroll cut-off'];

/**
 * First-run setup wizard (docs/TENANT_CONFIGURATION.md "Onboarding flow"
 * step 3 — the last piece of module 13). Skippable, resumable: progress is
 * `TenantSettings.setupWizardStatus`/`setupWizardStep`
 * (`GET`/`PATCH /api/tenant-config/wizard`). Deliberately orchestrates
 * EXISTING endpoints (Attendance's general settings + shifts, Leave's
 * holidays + types) rather than introducing new business logic — this is
 * purely a guided front-door onto config that already works standalone.
 */
export function SetupWizard() {
  const { user } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const checkedRef = React.useRef(false);
  const saveRef = React.useRef<() => Promise<void> | void>(() => {});
  const registerSave = React.useCallback<RegisterSave>((fn) => {
    saveRef.current = fn;
  }, []);

  React.useEffect(() => {
    if (user?.role !== 'COMPANY_ADMIN' || checkedRef.current) return;
    checkedRef.current = true;
    api
      .get<WizardState>('/tenant-config/wizard')
      .then((s) => {
        if (s.status === 'PENDING' || s.status === 'IN_PROGRESS') {
          setStep(s.step);
          setOpen(true);
        }
      })
      .catch(() => undefined);
  }, [user?.role]);

  async function persist(next: Partial<WizardState> & { step: number }) {
    await api
      .patch('/tenant-config/wizard', { status: next.status ?? 'IN_PROGRESS', step: next.step })
      .catch(() => undefined);
  }

  async function commitCurrentStep() {
    await saveRef.current();
    saveRef.current = () => {};
  }

  async function goNext() {
    setBusy(true);
    try {
      await commitCurrentStep();
      const nextStep = step + 1;
      if (nextStep >= STEP_LABELS.length) {
        await persist({ status: 'COMPLETED', step });
        setOpen(false);
        return;
      }
      setStep(nextStep);
      await persist({ step: nextStep });
    } finally {
      setBusy(false);
    }
  }

  async function goBack() {
    setBusy(true);
    try {
      await commitCurrentStep();
      const prevStep = Math.max(0, step - 1);
      setStep(prevStep);
      await persist({ step: prevStep });
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    setBusy(true);
    try {
      await commitCurrentStep();
      await persist({ status: 'DISMISSED', step });
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (user?.role !== 'COMPANY_ADMIN') return null;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-40 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg hover:opacity-90"
        >
          Setup wizard
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader
            title="Set up your workspace"
            description={`Step ${step + 1} of ${STEP_LABELS.length} — skippable, and you can resume anytime.`}
            onClose={() => setOpen(false)}
          />

          <div className="mb-5 flex items-center gap-1.5">
            {STEP_LABELS.map((label, i) => (
              <div key={label} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                    i < step
                      ? 'bg-success text-success-foreground'
                      : i === step
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-muted-foreground',
                  )}
                >
                  {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <span className="hidden text-center text-[10px] text-muted-foreground sm:block">
                  {label}
                </span>
              </div>
            ))}
          </div>

          {step === 0 && <WorkWeekStep registerSave={registerSave} />}
          {step === 1 && <DefaultShiftStep registerSave={registerSave} />}
          {step === 2 && <HolidaysStep />}
          {step === 3 && <LeaveTypesStep />}
          {step === 4 && <PayrollCutoffStep registerSave={registerSave} />}

          <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
            <Button variant="ghost" size="sm" onClick={skip} disabled={busy}>
              Skip for now
            </Button>
            <div className="flex gap-2">
              {step > 0 && (
                <Button variant="outline" size="sm" onClick={goBack} disabled={busy}>
                  Back
                </Button>
              )}
              <Button size="sm" onClick={goNext} disabled={busy}>
                {step === STEP_LABELS.length - 1 ? 'Finish' : 'Next'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function WorkWeekStep({ registerSave }: { registerSave: RegisterSave }) {
  const [config, setConfig] = React.useState<AttendanceConfig | null>(null);
  React.useEffect(() => {
    api.get<AttendanceConfig>('/attendance/settings').then(setConfig);
  }, []);
  React.useEffect(() => {
    if (!config) return;
    registerSave(async () => { await api.patch('/attendance/settings', config).catch(() => undefined); });
  }, [config, registerSave]);

  if (!config) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        The days and timezone the rest of the app — leave, attendance, payroll — counts against.
      </p>
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
      <Field label="Timezone" hint="IANA zone, e.g. Asia/Kolkata">
        <Input
          value={config.timezone}
          onChange={(e) => setConfig((c) => (c ? { ...c, timezone: e.target.value } : c))}
        />
      </Field>
    </div>
  );
}

function DefaultShiftStep({ registerSave }: { registerSave: RegisterSave }) {
  const [shift, setShift] = React.useState<Shift | null>(null);
  React.useEffect(() => {
    api.get<Shift[]>('/attendance/shifts').then((shifts) => {
      setShift(shifts.find((s) => s.isDefault) ?? shifts[0] ?? null);
    });
  }, []);
  React.useEffect(() => {
    if (!shift) return;
    registerSave(async () => { await api.patch(`/attendance/shifts/${shift.id}`, shift).catch(() => undefined); });
  }, [shift, registerSave]);

  if (!shift) {
    return (
      <p className="text-sm text-muted-foreground">
        No shift found for this tenant yet — configure one later from Attendance → Settings.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Your default working hours — the fallback for anyone without a specific shift assigned
        (e.g. rota staff).
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Start time</Label>
          <Input
            type="time"
            value={shift.startTime}
            onChange={(e) => setShift((s) => (s ? { ...s, startTime: e.target.value } : s))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>End time</Label>
          <Input
            type="time"
            value={shift.endTime}
            onChange={(e) => setShift((s) => (s ? { ...s, endTime: e.target.value } : s))}
          />
        </div>
      </div>
      <Field label="Grace period (minutes)" hint="A check-in after start + grace counts as late.">
        <Input
          type="number"
          min={0}
          value={shift.graceMinutes}
          onChange={(e) => setShift((s) => (s ? { ...s, graceMinutes: Number(e.target.value) } : s))}
        />
      </Field>
    </div>
  );
}

function HolidaysStep() {
  const year = new Date().getFullYear();
  const [holidays, setHolidays] = React.useState<Holiday[] | null>(null);
  const [name, setName] = React.useState('');
  const [date, setDate] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    leaveApi.listHolidays(year).then(setHolidays);
  }, [year]);
  React.useEffect(load, [load]);

  async function add() {
    if (!name || !date) return;
    setBusy(true);
    try {
      await leaveApi.createHoliday({ name, date, optional: false });
      setName('');
      setDate('');
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Add this year's company holidays now, or later from Leave → Holidays.
      </p>
      {!holidays ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto text-sm">
          {holidays.length === 0 && <li className="text-muted-foreground">None added yet.</li>}
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center justify-between">
              <span>{h.name}</span>
              <span className="text-muted-foreground">{h.date.slice(0, 10)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Diwali" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <Button type="button" size="sm" disabled={busy || !name || !date} onClick={add}>
          Add
        </Button>
      </div>
    </div>
  );
}

function LeaveTypesStep() {
  const [types, setTypes] = React.useState<LeaveType[] | null>(null);
  React.useEffect(() => {
    leaveApi.listTypes(true).then(setTypes);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Your leave types and their annual quotas — already seeded with sensible defaults.
        Fine-tune these anytime from Leave → Leave Types.
      </p>
      {!types ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-sm">
          {types.map((t) => (
            <li key={t.id} className="flex items-center justify-between">
              <span>
                {t.name} <span className="text-muted-foreground">({t.code})</span>
              </span>
              <span className="text-muted-foreground">{t.annualQuota} days/yr</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PayrollCutoffStep({ registerSave }: { registerSave: RegisterSave }) {
  const [config, setConfig] = React.useState<AttendanceConfig | null>(null);
  React.useEffect(() => {
    api.get<AttendanceConfig>('/attendance/settings').then(setConfig);
  }, []);
  React.useEffect(() => {
    if (!config) return;
    registerSave(async () => { await api.patch('/attendance/settings', config).catch(() => undefined); });
  }, [config, registerSave]);

  if (!config) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        The day of the month the payroll period locks — the deadline attendance regularization
        requests auto-resolve against.
      </p>
      <Field label="Payroll cut-off day">
        <Input
          type="number"
          min={1}
          max={28}
          value={config.payrollCutoffDay}
          onChange={(e) => setConfig((c) => (c ? { ...c, payrollCutoffDay: Number(e.target.value) } : c))}
        />
      </Field>
    </div>
  );
}
