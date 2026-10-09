import * as React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { platformApi, isPlatformApiError } from '@/lib/platform-api';
import { fmtDate } from '../lib/format';
import { inr } from '../lib/plan-catalog';
import type { TenantPayment, TenantRow } from '../lib/types';

/**
 * Razorpay billing for one tenant: create the subscription (returns the link
 * the customer pays through) and see every captured charge. Payment state
 * itself is driven by Razorpay's webhook — nothing here marks anything paid.
 */
export function BillingCard({ tenant, onChanged }: { tenant: TenantRow; onChanged: () => void }) {
  const { toast } = useToast();
  const sub = tenant.subscription;
  const [payments, setPayments] = React.useState<TenantPayment[] | null>(null);
  const [link, setLink] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    platformApi
      .listPayments(tenant.id)
      .then((p) => live && setPayments(p))
      .catch(() => live && setPayments([]));
    return () => {
      live = false;
    };
  }, [tenant.id, sub?.razorpaySubscriptionId]);

  async function subscribe() {
    setBusy(true);
    try {
      const res = await platformApi.subscribeBilling(tenant.id);
      setLink(res.paymentUrl);
      toast({ title: 'Razorpay subscription created' });
      onChanged();
    } catch (e) {
      toast({ title: isPlatformApiError(e) ? e.message : 'Could not create the subscription' });
    } finally {
      setBusy(false);
    }
  }

  const overdue = sub?.graceEndsAt ? fmtDate(sub.graceEndsAt) : null;

  return (
    <Card className="flex flex-col gap-3 p-5">
      <p className="text-sm font-semibold">Billing (Razorpay)</p>
      {sub?.razorpaySubscriptionId ? (
        <p className="text-xs text-muted-foreground">
          Subscription <span className="font-mono">{sub.razorpaySubscriptionId}</span> · charged
          monthly · next renewal {fmtDate(sub.renewsAt)}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Not billed through Razorpay. Create a subscription and send the customer the payment
          link, or use <strong>Convert to paid</strong> for offline payment.
        </p>
      )}
      {overdue && (
        <p className="rounded-lg bg-warning/10 p-2 text-xs text-warning">
          A charge failed. The workspace goes read-only on {overdue} unless a payment succeeds.
        </p>
      )}
      {!sub?.razorpaySubscriptionId && (
        <div>
          <Button size="sm" variant="outline" disabled={busy} onClick={subscribe}>
            Create payment link
          </Button>
        </div>
      )}
      {link && (
        <div className="rounded-lg border border-border p-2 text-xs">
          <p className="mb-1 text-muted-foreground">Send this link to the customer:</p>
          <a href={link} target="_blank" rel="noreferrer" className="break-all text-primary underline">
            {link}
          </a>
        </div>
      )}
      <div>
        <p className="mb-1 text-xs font-medium">Payments</p>
        {payments == null ? null : payments.length === 0 ? (
          <p className="text-xs text-muted-foreground">No payments recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-xs">
            {payments.map((p) => (
              <li key={p.id} className="flex justify-between gap-2">
                <span>{fmtDate(p.paidAt)}</span>
                <span className="font-mono text-muted-foreground">{p.razorpayPaymentId}</span>
                <span className="font-medium">{inr(Number(p.amount), p.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
