import * as React from 'react';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { platformApi, isPlatformApiError } from '@/lib/platform-api';
import {
  ALL_MODULES,
  FEATURE_KEYS,
  featureLabel,
  inr,
  moduleLabel,
  monthlyTotal,
} from '../lib/plan-catalog';
import type { IsolationTier, Plan, UpdatePlanInput } from '../lib/types';

/**
 * Edit one plan in the catalog. `PATCH /api/platform-admin/plans/:key`.
 * Saving does NOT touch any live tenant — each Subscription carries a
 * snapshot; tenants pick up plan changes only on renewal (or an explicit
 * plan change). The dialog says so.
 */
export function PlanEditDialog({
  plan,
  open,
  onOpenChange,
  onDone,
}: {
  plan: Plan | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = React.useState<{
    name: string;
    listPricePerSeat: string;
    currency: string;
    seatsIncluded: string;
    enabledModules: string[];
    features: Record<string, boolean>;
    isolationTier: IsolationTier;
  } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open && plan) {
      setForm({
        name: plan.name,
        listPricePerSeat: String(Number(plan.listPricePerSeat)),
        currency: plan.currency,
        seatsIncluded: String(plan.seatsIncluded),
        enabledModules: [...plan.enabledModules],
        features: { ...plan.features },
        isolationTier: plan.isolationTier,
      });
      setErr(null);
    }
  }, [open, plan]);

  if (!plan || !form) return null;

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));
  const toggleModule = (m: string) =>
    set(
      'enabledModules',
      form.enabledModules.includes(m)
        ? form.enabledModules.filter((x) => x !== m)
        : [...form.enabledModules, m],
    );

  async function save() {
    if (!form) return;
    const price = Number(form.listPricePerSeat);
    const seats = Number(form.seatsIncluded);
    if (!form.name.trim() || !Number.isFinite(price) || price < 0 || !Number.isInteger(seats) || seats < 1) {
      setErr('Check name, per-seat price (≥ 0) and default seats (whole number ≥ 1).');
      return;
    }
    const body: UpdatePlanInput = {
      name: form.name.trim(),
      listPricePerSeat: price,
      currency: form.currency.trim().toUpperCase(),
      seatsIncluded: seats,
      enabledModules: ALL_MODULES.filter((m) => form.enabledModules.includes(m)),
      features: form.features,
      isolationTier: form.isolationTier,
    };
    setBusy(true);
    setErr(null);
    try {
      await platformApi.updatePlan(plan!.key, body);
      toast({ title: `${plan!.name} plan updated` });
      onOpenChange(false);
      onDone();
    } catch (e) {
      setErr(isPlatformApiError(e) ? e.message : 'Save failed — retry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader
          title={`Edit ${plan.name} plan`}
          description={`${plan.tenantCount} tenant${plan.tenantCount === 1 ? '' : 's'} currently on this plan`}
          onClose={() => onOpenChange(false)}
        />

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Isolation tier">
              <Select
                value={form.isolationTier}
                onChange={(e) => set('isolationTier', e.target.value as IsolationTier)}
              >
                <option value="POOLED">Pooled (shared DB + RLS)</option>
                <option value="DEDICATED">Dedicated (database-per-tenant)</option>
              </Select>
            </Field>
            <Field label={`List price / seat / month (${form.currency})`}>
              <Input
                type="number"
                min={0}
                value={form.listPricePerSeat}
                onChange={(e) => set('listPricePerSeat', e.target.value)}
              />
            </Field>
            <Field label="Default seats (onboarding pre-fill)">
              <Input
                type="number"
                min={1}
                value={form.seatsIncluded}
                onChange={(e) => set('seatsIncluded', e.target.value)}
              />
            </Field>
          </div>

          <p className="-mt-1 text-xs text-muted-foreground">
            ≈ {inr(monthlyTotal(form.listPricePerSeat, Number(form.seatsIncluded)), form.currency)}/mo
            at {form.seatsIncluded || 0} seats. Each deal gets its own negotiated rate at
            onboarding — this is only the list price.
          </p>

          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Enabled modules</p>
            <div className="flex flex-col gap-1.5">
              {ALL_MODULES.map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.enabledModules.includes(m)}
                    disabled={m === 'CORE_HR'}
                    onChange={() => toggleModule(m)}
                  />
                  <span className={cn(m === 'CORE_HR' && 'text-muted-foreground')}>
                    {moduleLabel(m)}
                    {m === 'CORE_HR' && ' · always on'}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Premium features</p>
            <div className="flex flex-col gap-1.5">
              {FEATURE_KEYS.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!form.features[k]}
                    onChange={(e) =>
                      set('features', { ...form.features, [k]: e.target.checked })
                    }
                  />
                  {featureLabel(k)}
                </label>
              ))}
            </div>
          </div>

          <p className="rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
            Saving updates the catalog only. Tenants already on {plan.name} keep their current
            terms until their next <strong>renewal</strong> (or an explicit plan change).
          </p>
        </div>

        {err && <p className="mt-3 text-sm text-destructive">{err}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? '…' : 'Save plan'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
