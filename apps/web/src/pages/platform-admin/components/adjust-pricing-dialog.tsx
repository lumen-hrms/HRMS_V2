import * as React from 'react';
import { ArrowRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { platformApi, isPlatformApiError } from '@/lib/platform-api';
import { inr, monthlyTotal } from '../lib/plan-catalog';
import type { TenantRow } from '../lib/types';

/**
 * Adjust a tenant's commercials WITHOUT a plan change — the negotiation
 * lever. `PATCH /api/platform-admin/tenants/:id/pricing`. Sets the
 * negotiated per-seat rate and/or seat count on the live Subscription;
 * entitlements are untouched. Audits `subscription.price_adjusted`.
 */
export function AdjustPricingDialog({
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
  const sub = tenant?.subscription ?? null;
  const curRate = sub?.pricePerSeat != null ? Number(sub.pricePerSeat) : 0;
  const curSeats = sub?.seats ?? 0;

  const [rate, setRate] = React.useState(String(curRate));
  const [seats, setSeats] = React.useState(String(curSeats));
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setRate(String(curRate));
      setSeats(String(curSeats));
      setReason('');
      setErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tenant]);

  if (!tenant || !sub) return null;

  const nextRate = Number(rate);
  const nextSeats = Number(seats);
  const valid =
    Number.isFinite(nextRate) &&
    nextRate >= 0 &&
    Number.isInteger(nextSeats) &&
    nextSeats >= 1;
  const changed = valid && (nextRate !== curRate || nextSeats !== curSeats);

  async function submit() {
    if (!tenant) return;
    if (!changed) {
      setErr('Change the rate or the seat count.');
      return;
    }
    if (reason.trim().length < 5) {
      setErr('A reason of at least 5 characters is required.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await platformApi.adjustPricing(tenant.id, {
        pricePerSeat: nextRate !== curRate ? nextRate : undefined,
        seats: nextSeats !== curSeats ? nextSeats : undefined,
        reason: reason.trim(),
      });
      toast({ title: 'Pricing updated' });
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
          title="Adjust pricing"
          description={`${tenant.name} · ${sub.plan} plan — commercials only, entitlements unchanged`}
          onClose={() => onOpenChange(false)}
        />

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ap-rate">Price / seat / month</Label>
            <Input
              id="ap-rate"
              type="number"
              min={0}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ap-seats">Seats</Label>
            <Input
              id="ap-seats"
              type="number"
              min={1}
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
            />
          </div>
        </div>

        <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs">
          <span className="text-muted-foreground">
            {inr(curRate)}/seat × {curSeats} = {inr(monthlyTotal(curRate, curSeats))}/mo
          </span>
          <ArrowRight className="h-3 w-3 shrink-0" />
          <span className="font-medium text-foreground">
            {inr(valid ? nextRate : 0)}/seat × {valid ? nextSeats : 0} ={' '}
            {inr(monthlyTotal(valid ? nextRate : 0, valid ? nextSeats : 0))}/mo
          </span>
        </div>

        {nextSeats < tenant.employeeCount && valid && (
          <div className="mb-4 rounded-lg bg-warning/10 p-3 text-xs text-warning">
            {tenant.employeeCount} employees exceed {nextSeats} seats — existing data is kept, new
            logins may be blocked.
          </div>
        )}

        <div className="mb-4 flex flex-col gap-1.5">
          <Label htmlFor="ap-reason">Reason (platform audit log)</Label>
          <Textarea
            id="ap-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Renegotiated to ₹280/seat per order form #1187."
          />
        </div>

        {err && <p className="mb-3 text-sm text-destructive">{err}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !changed || reason.trim().length < 5}>
            {busy ? '…' : 'Save pricing'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
