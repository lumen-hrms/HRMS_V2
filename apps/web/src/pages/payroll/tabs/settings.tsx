import * as React from 'react';
import * as payroll from '@/lib/payroll/client';
import type { PayrollSettings } from '@/lib/payroll/types';
import { isApiError } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { SkeletonRows } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { PtSlabEditor } from '../components/pt-slab-editor';
import { TaxSlabEditor } from '../components/tax-slab-editor';
import { fmtDateTime } from '../components/format';

const LEAVE_ENCASHMENT_COMPONENT_OPTIONS = ['BASIC', 'DA', 'HRA', 'SPECIAL_ALLOWANCE', 'CONVEYANCE', 'LTA', 'MEDICAL'];

type NumKey = Exclude<
  keyof PayrollSettings,
  'updatedAt' | 'allowEpfAboveCeiling' | 'overtimeEnabled' | 'leaveEncashmentComponents'
>;

interface NumField {
  key: NumKey;
  label: string;
  hint: string;
  min: number;
  max?: number;
  step?: string;
  integer?: boolean;
}

const pct = (key: NumKey, label: string, hint: string, step = '0.01'): NumField => ({ key, label, hint, min: 0, max: 100, step });

type GroupId = 'statutory' | 'overtime' | 'fnf' | 'pt' | 'tax';
interface Group {
  id: GroupId;
  label: string;
  description: string;
  numbers: NumField[];
  flags: Array<'allowEpfAboveCeiling' | 'overtimeEnabled' | 'leaveEncashmentComponents'>;
}

const GROUPS: Group[] = [
  {
    id: 'statutory',
    label: 'Statutory rates',
    description: 'EPF and ESI percentages and wage ceilings. These change when the government revises them — usually once a year.',
    numbers: [
      pct('minBasicPercent', 'Basic floor (% of CTC)', 'Basic pay is never set below this share of CTC.'),
      { key: 'epfCeiling', label: 'EPF wage ceiling (₹)', hint: 'Monthly wage above which EPF stops (unless allowed below).', min: 0, step: '1' },
      pct('epfEmployeeRate', 'EPF employee %', 'Deducted from the employee’s pay.'),
      pct('epsRate', 'EPS %', 'Pension share of the employer contribution.'),
      pct('epfEmployerRate', 'EPF employer %', 'Provident-fund share of the employer contribution.'),
      pct('epfAdminRate', 'EPF admin %', 'Employer’s administration charge.'),
      pct('edliRate', 'EDLI %', 'Employer’s deposit-linked insurance charge.'),
      { key: 'esiWageCeiling', label: 'ESI wage ceiling (₹)', hint: 'ESI applies to monthly gross up to this amount.', min: 0, step: '1' },
      pct('esiEmployeeRate', 'ESI employee %', 'Deducted from the employee’s pay.', '0.001'),
      pct('esiEmployerRate', 'ESI employer %', 'Paid by the employer on top of pay.', '0.001'),
    ],
    flags: ['allowEpfAboveCeiling'],
  },
  {
    id: 'overtime',
    label: 'Overtime',
    description: 'Pays approved overtime hours at a multiple of the hourly basic rate.',
    numbers: [{ key: 'overtimeMultiplier', label: 'Overtime multiplier', hint: 'e.g. 2 pays double the hourly rate. Minimum 1.', min: 1, step: '0.1' }],
    flags: ['overtimeEnabled'],
  },
  {
    id: 'fnf',
    label: 'Full & Final',
    description: 'Formulas used to settle leave encashment and gratuity when someone leaves.',
    numbers: [
      { key: 'leaveEncashmentDivisor', label: 'Leave encashment divisor', hint: 'Days used to turn monthly pay into a daily rate (e.g. 26 or 30). Minimum 1.', min: 1, step: '0.01' },
      { key: 'gratuityEligibilityYears', label: 'Gratuity eligibility (years)', hint: 'Years of service needed (the Act says 5).', min: 0, step: '1', integer: true },
      { key: 'gratuityDaysPerYear', label: 'Gratuity days per year', hint: 'Usually 15 days of pay per year served.', min: 0, step: '0.01' },
      { key: 'gratuityMonthDivisor', label: 'Gratuity month divisor', hint: 'Days in the month used for the daily rate (e.g. 26). Minimum 1.', min: 1, step: '0.01' },
      { key: 'gratuityMaxAmount', label: 'Gratuity max payout (₹)', hint: 'Statutory cap, currently ₹20,00,000.', min: 1, step: '1' },
    ],
    flags: ['leaveEncashmentComponents'],
  },
  { id: 'pt', label: 'Professional Tax', description: 'State-wise monthly slabs.', numbers: [], flags: [] },
  { id: 'tax', label: 'Income tax (TDS)', description: 'Slabs and standard deduction per regime and financial year.', numbers: [], flags: [] },
];

function numberError(f: NumField, raw: unknown): string | undefined {
  const text = String(raw ?? '').trim();
  if (text === '') return `Enter a number for ${f.label.toLowerCase()}`;
  const n = Number(text);
  if (!Number.isFinite(n)) return 'Enter a valid number';
  if (f.integer && !Number.isInteger(n)) return 'Enter a whole number';
  if (n < f.min) return `Must be at least ${f.min}`;
  if (f.max !== undefined && n > f.max) return `Can’t be more than ${f.max}`;
  return undefined;
}

export function SettingsTab({ readOnly }: { readOnly: boolean }) {
  const { toast } = useToast();
  const [saved, setSaved] = React.useState<PayrollSettings | null>(null);
  const [draft, setDraft] = React.useState<PayrollSettings | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [group, setGroup] = React.useState<GroupId>('statutory');
  const [busy, setBusy] = React.useState(false);
  const [showErrors, setShowErrors] = React.useState(false);

  const load = React.useCallback(() => {
    setLoadError(null);
    payroll
      .getSettings()
      .then((s) => {
        setSaved(s);
        setDraft(s);
      })
      .catch((err) => setLoadError(isApiError(err) ? err.message : 'Could not load settings'));
  }, []);
  React.useEffect(load, [load]);

  const current = GROUPS.find((g) => g.id === group)!;
  const keysOf = (g: Group): Array<keyof PayrollSettings> => [...g.numbers.map((f) => f.key), ...g.flags];

  const isDirty = (g: Group) =>
    !!saved && !!draft && keysOf(g).some((k) => JSON.stringify(draft[k]) !== JSON.stringify(saved[k]));
  const errorsFor = (g: Group) =>
    Object.fromEntries(g.numbers.map((f) => [f.key, draft ? numberError(f, draft[f.key]) : undefined]));

  async function save(g: Group) {
    if (!draft) return;
    const errs = errorsFor(g);
    if (Object.values(errs).some(Boolean)) {
      setShowErrors(true);
      toast({ title: 'Fix the highlighted values first', tone: 'error' });
      return;
    }
    setBusy(true);
    try {
      // Only this group's fields; the API rejects unknown properties and wants numbers.
      const payload = Object.fromEntries(
        keysOf(g).map((k) => [k, g.numbers.some((f) => f.key === k) ? Number(draft[k]) : draft[k]]),
      ) as Partial<PayrollSettings>;
      const updated = await payroll.updateSettings(payload);
      setSaved(updated);
      setDraft((d) => (d ? { ...d, ...Object.fromEntries(keysOf(g).map((k) => [k, updated[k]])) } : d));
      setShowErrors(false);
      toast({ title: `${g.label} saved`, tone: 'success' });
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Save failed', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  function discard(g: Group) {
    if (!saved) return;
    setDraft((d) => (d ? { ...d, ...Object.fromEntries(keysOf(g).map((k) => [k, saved[k]])) } : d));
    setShowErrors(false);
  }

  const errs = draft ? errorsFor(current) : {};
  const dirty = isDirty(current);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {GROUPS.map((g) => (
          <button
            key={g.id}
            onClick={() => {
              setGroup(g.id);
              setShowErrors(false);
            }}
            aria-pressed={g.id === group}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              g.id === group ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-accent',
            )}
          >
            {g.label}
            {isDirty(g) && <span className="ml-1.5 text-xs">●</span>}
          </button>
        ))}
      </div>

      <Card className="max-w-4xl">
        <CardHeader>
          <CardTitle className="text-base">{current.label}</CardTitle>
          <CardDescription>{current.description}</CardDescription>
        </CardHeader>
        <CardContent>
          {group === 'pt' ? (
            <PtSlabEditor readOnly={readOnly} />
          ) : group === 'tax' ? (
            <TaxSlabEditor readOnly={readOnly} />
          ) : loadError ? (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span>{loadError}</span>
              <Button size="sm" variant="outline" onClick={load}>
                Retry
              </Button>
            </div>
          ) : !draft ? (
            <SkeletonRows rows={5} />
          ) : (
            <form
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                save(current);
              }}
            >
              {current.flags.includes('overtimeEnabled') && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input"
                    checked={draft.overtimeEnabled}
                    disabled={readOnly}
                    onChange={(e) => setDraft({ ...draft, overtimeEnabled: e.target.checked })}
                  />
                  Pay approved overtime
                </label>
              )}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {current.numbers.map((f) => (
                  <Field key={f.key} label={f.label} hint={f.hint} error={showErrors ? errs[f.key] : undefined}>
                    <Input
                      type="number"
                      step={f.step}
                      min={f.min}
                      max={f.max}
                      disabled={readOnly}
                      value={String(draft[f.key] ?? '')}
                      aria-invalid={showErrors && errs[f.key] ? true : undefined}
                      onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                    />
                  </Field>
                ))}
              </div>
              {current.flags.includes('allowEpfAboveCeiling') && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input"
                    checked={draft.allowEpfAboveCeiling}
                    disabled={readOnly}
                    onChange={(e) => setDraft({ ...draft, allowEpfAboveCeiling: e.target.checked })}
                  />
                  Allow EPF contribution above the wage ceiling
                </label>
              )}
              {current.flags.includes('leaveEncashmentComponents') && (
                <Field label="Leave encashment components" hint="Which salary components make up the daily rate used for encashment.">
                  <div className="flex flex-wrap gap-3">
                    {LEAVE_ENCASHMENT_COMPONENT_OPTIONS.map((code) => (
                      <label key={code} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-input"
                          checked={draft.leaveEncashmentComponents.includes(code)}
                          disabled={readOnly}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              leaveEncashmentComponents: e.target.checked
                                ? [...draft.leaveEncashmentComponents, code]
                                : draft.leaveEncashmentComponents.filter((c) => c !== code),
                            })
                          }
                        />
                        {code}
                      </label>
                    ))}
                  </div>
                </Field>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                <span className="text-xs text-muted-foreground">
                  {saved?.updatedAt ? `Last saved ${fmtDateTime(saved.updatedAt)}` : 'Using default values'}
                </span>
                {!readOnly && (
                  <span className="flex gap-2">
                    <Button type="button" variant="outline" disabled={!dirty || busy} onClick={() => discard(current)}>
                      Discard changes
                    </Button>
                    <Button type="submit" disabled={!dirty || busy}>
                      {busy ? 'Saving…' : `Save ${current.label.toLowerCase()}`}
                    </Button>
                  </span>
                )}
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
