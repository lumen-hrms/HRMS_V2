import * as React from 'react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { fmtCountdown, fmtDateTime } from '../lib/format';
import type { BreakGlassGrant } from '../lib/types';

/**
 * Live status of an ACTIVE break-glass grant for a tenant — reason, granted
 * time, a countdown to expiry, access count, and Revoke now. Only rendered
 * when a grant is active. TODO(api): no backend for the grant lifecycle yet,
 * so in practice this never shows; it exists for when it does.
 */
export function BreakGlassStatusSheet({
  grant,
  open,
  onOpenChange,
  onRevoked,
}: {
  grant: BreakGlassGrant | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onRevoked: () => void;
}) {
  const { toast } = useToast();
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [open]);

  if (!grant) return null;
  const msLeft = new Date(grant.expiresAt).getTime() - now;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Break-glass access — active"
      description={grant.tenantName}
      footer={
        <Button
          variant="destructive"
          className="w-full"
          onClick={() => {
            toast({ title: 'Break-glass access revoked' });
            onRevoked();
          }}
        >
          Revoke access now
        </Button>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <div className="rounded-lg bg-warning/10 p-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-warning">
            Time remaining
          </p>
          <p className="mt-1 font-mono text-2xl font-bold text-warning">
            {fmtCountdown(msLeft)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Expires {fmtDateTime(grant.expiresAt)}</p>
        </div>

        <Detail label="Reason" value={grant.reason} />
        <Detail label="Granted" value={fmtDateTime(grant.grantedAt)} />
        <Detail label="Reads recorded" value={String(grant.accessCount)} />

        <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          Access is <strong>read-only</strong> and every query is written to the platform audit log
          and the tenant's own compliance view. It ends automatically at expiry.
        </p>
      </div>
    </Sheet>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5">{value}</p>
    </div>
  );
}
