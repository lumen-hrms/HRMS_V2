import * as React from 'react';
import * as payroll from '@/lib/payroll/client';
import type { PayrollSettings } from '@/lib/payroll/types';
import { isApiError } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { SkeletonRows } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { PtSlabEditor } from '../components/pt-slab-editor';
import { TaxSlabEditor } from '../components/tax-slab-editor';

const LEAVE_ENCASHMENT_COMPONENT_OPTIONS = ['BASIC', 'DA', 'HRA', 'SPECIAL_ALLOWANCE', 'CONVEYANCE', 'LTA', 'MEDICAL'];

export function SettingsTab({ readOnly }: { readOnly: boolean }) {
  const { toast } = useToast();
  const [settings, setSettings] = React.useState<PayrollSettings | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    payroll.getSettings().then(setSettings);
  }, []);
  React.useEffect(load, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setBusy(true);
    try {
      const updated = await payroll.updateSettings(settings);
      setSettings(updated);
      toast({ title: 'Settings saved', tone: 'success' });
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Save failed', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  function num(key: keyof PayrollSettings) {
    return {
      value: settings ? Number(settings[key]) : 0,
      disabled: readOnly,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setSettings((s) => (s ? { ...s, [key]: e.target.value as any } : s)),
    };
  }

  return (
    <div className="flex flex-col gap-5">
      <Card className="max-w-3xl p-5">
        <h3 className="mb-4 text-sm font-semibold">Statutory rates</h3>
        {!settings ? (
          <SkeletonRows rows={5} />
        ) : (
          <form onSubmit={save} className="flex flex-col gap-4">
            <Field label="Basic floor (% of CTC)">
              <Input type="number" step="0.01" {...num('minBasicPercent')} />
            </Field>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Field label="EPF ceiling (₹)">
                <Input type="number" {...num('epfCeiling')} />
              </Field>
              <Field label="EPF employee %">
                <Input type="number" step="0.01" {...num('epfEmployeeRate')} />
              </Field>
              <Field label="EPS %">
                <Input type="number" step="0.01" {...num('epsRate')} />
              </Field>
              <Field label="EPF employer %">
                <Input type="number" step="0.01" {...num('epfEmployerRate')} />
              </Field>
              <Field label="EPF admin %">
                <Input type="number" step="0.01" {...num('epfAdminRate')} />
              </Field>
              <Field label="EDLI %">
                <Input type="number" step="0.01" {...num('edliRate')} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={settings.allowEpfAboveCeiling}
                disabled={readOnly}
                onChange={(e) => setSettings((s) => (s ? { ...s, allowEpfAboveCeiling: e.target.checked } : s))}
              />
              Allow EPF contribution above the ceiling
            </label>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Field label="ESI wage ceiling (₹)">
                <Input type="number" {...num('esiWageCeiling')} />
              </Field>
              <Field label="ESI employee %">
                <Input type="number" step="0.001" {...num('esiEmployeeRate')} />
              </Field>
              <Field label="ESI employer %">
                <Input type="number" step="0.001" {...num('esiEmployerRate')} />
              </Field>
            </div>

            <div className="border-t border-border pt-4">
              <h4 className="mb-3 text-sm font-semibold">Overtime</h4>
              <label className="mb-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={settings.overtimeEnabled}
                  disabled={readOnly}
                  onChange={(e) => setSettings((s) => (s ? { ...s, overtimeEnabled: e.target.checked } : s))}
                />
                Overtime enabled
              </label>
              <Field label="Overtime multiplier" className="max-w-xs">
                <Input type="number" step="0.1" {...num('overtimeMultiplier')} />
              </Field>
            </div>

            <div className="border-t border-border pt-4">
              <h4 className="mb-3 text-sm font-semibold">Full &amp; Final formulas</h4>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <Field label="Leave encashment divisor">
                  <Input type="number" step="0.01" {...num('leaveEncashmentDivisor')} />
                </Field>
                <Field label="Gratuity eligibility (years)">
                  <Input type="number" {...num('gratuityEligibilityYears')} />
                </Field>
                <Field label="Gratuity days / year">
                  <Input type="number" step="0.01" {...num('gratuityDaysPerYear')} />
                </Field>
                <Field label="Gratuity month divisor">
                  <Input type="number" step="0.01" {...num('gratuityMonthDivisor')} />
                </Field>
              </div>
              <Field label="Leave encashment components" className="mt-3">
                <div className="flex flex-wrap gap-3">
                  {LEAVE_ENCASHMENT_COMPONENT_OPTIONS.map((code) => (
                    <label key={code} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input"
                        checked={settings.leaveEncashmentComponents.includes(code)}
                        disabled={readOnly}
                        onChange={(e) =>
                          setSettings((s) =>
                            s
                              ? {
                                  ...s,
                                  leaveEncashmentComponents: e.target.checked
                                    ? [...s.leaveEncashmentComponents, code]
                                    : s.leaveEncashmentComponents.filter((c) => c !== code),
                                }
                              : s,
                          )
                        }
                      />
                      {code}
                    </label>
                  ))}
                </div>
              </Field>
            </div>

            {!readOnly && (
              <div className="flex justify-end">
                <Button type="submit" disabled={busy}>
                  {busy ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            )}
          </form>
        )}
      </Card>

      <Card className="max-w-3xl p-5">
        <h3 className="mb-4 text-sm font-semibold">Professional Tax slabs</h3>
        <PtSlabEditor readOnly={readOnly} />
      </Card>

      <Card className="max-w-3xl p-5">
        <h3 className="mb-4 text-sm font-semibold">Income tax (TDS) slabs</h3>
        <TaxSlabEditor readOnly={readOnly} />
      </Card>
    </div>
  );
}
