import * as React from 'react';
import { ArrowRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { platformApi, isPlatformApiError } from '@/lib/platform-api';
import { inr, moduleLabel } from '../lib/plan-catalog';
import type { Plan, SellablePlan, TenantRow } from '../lib/types';

/**
 * Change a tenant's plan. `PATCH /api/platform-admin/tenants/:id/plan` —
 * re-snapshots the plan's CURRENT definition (modules/features/seats/price/
 * tier) onto the Subscription and audits `tenant.plan_changed`. Plan data is
 * fetched fresh so the diff reflects any recent catalog edits.
 */
export function ChangePlanDialog({
  tenant,
  open,
  onOpenChange,
  onDone,
}: {
  tenant: TenantRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const current = (tenant?.subscription?.plan ?? 'STARTER') as SellablePlan;
  const [plans, setPlans] = React.useState<Plan[] | null>(null);
  const [next, setNext] = React.useState<SellablePlan>(current);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setNext((tenant?.subscription?.plan ?? 'STARTER') as SellablePlan);
    setReason('');
    setErr(null);
    setPlans(null);
    platformApi.listPlans().then(setPlans).catch(() => setPlans([]));
  }, [open, tenant]);

  if (!tenant) return null;

  const byKey = (k: SellablePlan) => plans?.find((p) => p.key === k) ?? null;
  const from = byKey(current);
  const to = byKey(next);
  const changed = next !== current;
  const removed = from && to ? from.enabledModules.filter((m) => !to.enabledModules.includes(m)) : [];
  const added = from && to ? to.enabledModules.filter((m) => !from.enabledModules.includes(m)) : [];
  const overSeat = !!to && to.seatsIncluded < tenant.employeeCount;

  async function submit() {
    if (!tenant || !to) return;
    if (reason.trim().length < 5) {
      setErr('A reason of at least 5 characters is required.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await platformApi.changePlan(tenant.id, next, reason.trim());
      toast({ title: `Plan changed to ${to.name}` });
      onOpenChange(false);
      onDone();
    } catch (e) {
      setErr(isPlatformApiError(e) ? e.message : 'Action failed — retry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title="Change plan"
          description={`${tenant.name} · currently ${from?.name ?? current}`}
          onClose={() => onOpenChange(false)}
        />

        {plans == null ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div className="mb-4 flex flex-col gap-1.5">
              <Label>New plan</Label>
              <div className="grid grid-cols-3 gap-2">
                {plans
                  .slice()
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setNext(p.key)}
                      className={cn(
                        'rounded-lg border p-2 text-xs font-medium transition-colors',
                        p.key === next
                          ? 'border-primary bg-accent ring-1 ring-primary'
                          : 'border-border hover:bg-accent',
                      )}
                    >
                      {p.name}
                    </button>
                  ))}
              </div>
            </div>

            {changed && from && to && (
              <div className="mb-4 rounded-lg border border-border bg-muted/40 p-3 text-xs">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  {from.name} <ArrowRight className="h-3 w-3" /> {to.name}
                </div>
                <div className="mt-1.5 flex flex-col gap-0.5 text-muted-foreground">
                  <span>
                    Seats {from.seatsIncluded} → {to.seatsIncluded} · list price{' '}
                    {inr(from.listPricePerSeat, from.currency)} →{' '}
                    {inr(to.listPricePerSeat, to.currency)}/seat/mo
                  </span>
                  {added.length > 0 && (
                    <span className="text-success">+ {added.map(moduleLabel).join(', ')}</span>
                  )}
                  {removed.length > 0 && (
                    <span className="text-warning">− {removed.map(moduleLabel).join(', ')}</span>
                  )}
                </div>
              </div>
            )}

            {changed && to && (
              <div className="mb-4 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                Resets the per-seat rate to {to.name}’s list price (
                {inr(to.listPricePerSeat, to.currency)}). Any negotiated rate is dropped — re-set it
                afterwards with <strong>Adjust pricing</strong>.
              </div>
            )}

            {overSeat && changed && (
              <div className="mb-4 rounded-lg bg-warning/10 p-3 text-xs text-warning">
                {tenant.employeeCount} employees exceed the new {to?.seatsIncluded}-seat limit —
                existing data is kept, new logins may be blocked.
              </div>
            )}
            {removed.length > 0 && changed && (
              <div className="mb-4 rounded-lg bg-warning/10 p-3 text-xs text-warning">
                Removes in-use module{removed.length > 1 ? 's' : ''}:{' '}
                {removed.map(moduleLabel).join(', ')}. Those modules stop resolving for the tenant.
              </div>
            )}

            <div className="mb-4 flex flex-col gap-1.5">
              <Label htmlFor="plan-reason">Reason (platform audit log)</Label>
              <Textarea
                id="plan-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Upgraded per signed order form #1042."
              />
            </div>

            {err && <p className="mb-3 text-sm text-destructive">{err}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={busy || !changed || reason.trim().length < 5}>
                {busy ? '…' : 'Apply'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
