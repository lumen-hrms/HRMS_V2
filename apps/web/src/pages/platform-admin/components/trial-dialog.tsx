import * as React from 'react';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { platformApi, isPlatformApiError } from '@/lib/platform-api';
import { PLAN_LABEL, type SellablePlan, type TenantRow } from '../lib/types';

const SELLABLE: SellablePlan[] = ['STARTER', 'GROWTH', 'ENTERPRISE'];

/** yyyy-mm-dd in local time, for <input type="date">. */
function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Two operator actions on a tenant that is still in its trial (or read-only
 * after it ended):
 *  - `trial`   — set when the trial ends. `PATCH /tenants/:id/trial`. A future
 *                date on a read-only tenant reopens the trial.
 *  - `convert` — confirm the paid plan after payment (payment is outside the
 *                app). `POST /tenants/:id/convert`. Ends the trial, makes the
 *                tenant Active and starts a one-year term.
 */
export function TrialDialog({
  mode,
  tenant,
  open,
  onOpenChange,
  onDone,
}: {
  mode: 'trial' | 'convert';
  tenant: TenantRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const currentPlan = (tenant?.subscription?.plan ?? 'STARTER') as SellablePlan;
  const [date, setDate] = React.useState('');
  const [plan, setPlan] = React.useState<SellablePlan>(
    SELLABLE.includes(currentPlan) ? currentPlan : 'STARTER',
  );
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !tenant) return;
    const existing = tenant.subscription?.trialEndsAt;
    const fallback = new Date(Date.now() + 7 * 86_400_000);
    setDate(toDateInput(existing ? new Date(existing) : fallback));
    setPlan(SELLABLE.includes(currentPlan) ? currentPlan : 'STARTER');
    setReason('');
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tenant]);

  if (!tenant) return null;

  async function submit() {
    if (!tenant) return;
    if (reason.trim().length < 5) {
      setErr('A reason of at least 5 characters is required.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (mode === 'trial') {
        // End of the chosen day, local time.
        const end = new Date(`${date}T23:59:59`);
        if (Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) {
          setErr('Pick a date later than today.');
          return;
        }
        await platformApi.setTrialEnd(tenant.id, end.toISOString(), reason.trim());
        toast({ title: 'Trial end date saved' });
      } else {
        await platformApi.convertTenant(tenant.id, plan, reason.trim());
        toast({ title: `${tenant.name} converted to ${PLAN_LABEL[plan]}` });
      }
      onOpenChange(false);
      onDone();
    } catch (e) {
      setErr(isPlatformApiError(e) ? e.message : 'Action failed — retry.');
    } finally {
      setBusy(false);
    }
  }

  const isTrial = mode === 'trial';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={isTrial ? 'Set trial end date' : 'Convert to paid plan'}
          description={tenant.name}
          onClose={() => onOpenChange(false)}
        />

        {isTrial ? (
          <div className="mb-4 flex flex-col gap-1.5">
            <Label htmlFor="trial-end">Trial ends on</Label>
            <Input
              id="trial-end"
              type="date"
              value={date}
              min={toDateInput(new Date(Date.now() + 86_400_000))}
              onChange={(e) => setDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {tenant.status === 'READ_ONLY'
                ? 'Saving a future date reopens the trial and returns the workspace to full access.'
                : 'The workspace turns read-only after this date unless it is converted.'}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-col gap-1.5">
              <Label>Paid plan</Label>
              <div className="grid grid-cols-3 gap-2">
                {SELLABLE.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setPlan(k)}
                    className={cn(
                      'rounded-lg border p-2 text-xs font-medium transition-colors',
                      k === plan
                        ? 'border-primary bg-accent ring-1 ring-primary'
                        : 'border-border hover:bg-accent',
                    )}
                  >
                    {PLAN_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-4 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
              Confirm payment was received outside the app first. This ends the trial, makes the
              tenant Active and starts a one-year term. A different plan from the current one is
              applied the same way as <strong>Change plan</strong>.
            </div>
          </>
        )}

        <div className="mb-4 flex flex-col gap-1.5">
          <Label htmlFor="trial-reason">Reason (audited)</Label>
          <Textarea
            id="trial-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={isTrial ? 'e.g. Extended at client’s request' : 'e.g. Invoice INV-1042 paid'}
          />
        </div>

        {err && <p className="mb-3 text-sm text-destructive">{err}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {isTrial ? 'Save trial end' : 'Convert tenant'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
