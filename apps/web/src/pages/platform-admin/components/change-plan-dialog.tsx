import * as React from 'react';
import { ArrowRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { platformApi, isPlatformApiError } from '@/lib/platform-api';
import { PLAN_CATALOG, SELLABLE_PLANS, inr, moduleLabel } from '../lib/plan-catalog';
import type { SellablePlan, TenantRow } from '../lib/types';

/**
 * Change a tenant's plan. `PATCH /api/platform-admin/tenants/:id/plan` —
 * TODO(api): endpoint not built. The dialog is complete (diff panel, seat /
 * module warnings, reason) and calls the endpoint; a 404 shows a "not wired
 * yet" toast rather than a hard error.
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
  const [next, setNext] = React.useState<SellablePlan>(current);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setNext((tenant?.subscription?.plan ?? 'STARTER') as SellablePlan);
      setReason('');
      setErr(null);
    }
  }, [open, tenant]);

  if (!tenant) return null;

  const from = PLAN_CATALOG[current] ?? PLAN_CATALOG.STARTER;
  const to = PLAN_CATALOG[next];
  const removed = from.modules.filter((m) => !to.modules.includes(m));
  const added = to.modules.filter((m) => !from.modules.includes(m));
  const overSeat = to.seatsIncluded < tenant.employeeCount;
  const changed = next !== current;

  async function submit() {
    if (!tenant) return;
    if (reason.trim().length < 5) {
      setErr('A reason of at least 5 characters is required.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await platformApi.changePlan(tenant.id, next, reason.trim());
      toast({ title: `Plan changed to ${to.label}` });
      onOpenChange(false);
      onDone();
    } catch (e) {
      if (isPlatformApiError(e) && e.status === 404) {
        toast({ title: 'Plan-change API not wired yet', tone: 'info' });
        onOpenChange(false);
      } else {
        setErr(isPlatformApiError(e) ? e.message : 'Action failed — retry.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title="Change plan"
          description={`${tenant.name} · currently ${from.label}`}
          onClose={() => onOpenChange(false)}
        />

        <div className="mb-4 flex flex-col gap-1.5">
          <Label htmlFor="plan-select">New plan</Label>
          <div className="grid grid-cols-3 gap-2">
            {SELLABLE_PLANS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setNext(p)}
                className={cn(
                  'rounded-lg border p-2 text-xs font-medium transition-colors',
                  p === next ? 'border-primary bg-accent ring-1 ring-primary' : 'border-border hover:bg-accent',
                )}
              >
                {PLAN_CATALOG[p].label}
              </button>
            ))}
          </div>
        </div>

        {changed && (
          <div className="mb-4 rounded-lg border border-border bg-muted/40 p-3 text-xs">
            <div className="flex items-center gap-2 font-medium text-foreground">
              {from.label} <ArrowRight className="h-3 w-3" /> {to.label}
            </div>
            <div className="mt-1.5 flex flex-col gap-0.5 text-muted-foreground">
              <span>
                Seats {from.seatsIncluded} → {to.seatsIncluded} · price {inr(from.priceMonthly)} →{' '}
                {inr(to.priceMonthly)}/mo
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

        {overSeat && changed && (
          <div className="mb-4 rounded-lg bg-warning/10 p-3 text-xs text-warning">
            {tenant.employeeCount} employees exceed the new {to.seatsIncluded}-seat limit — existing
            data is kept, new logins may be blocked.
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
      </DialogContent>
    </Dialog>
  );
}
