import * as React from 'react';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { platformApi, isPlatformApiError } from '@/lib/platform-api';
import type { TenantRow } from '../lib/types';

type Mode = 'suspend' | 'resume';

/**
 * Suspend / resume a tenant. `PATCH /api/platform-admin/tenants/:id/status`.
 * Suspending is a full stop — every user of the tenant loses access on their
 * next request — so the confirm spells out the blast radius.
 */
export function SuspendDialog({
  tenant,
  mode,
  open,
  onOpenChange,
  onDone,
}: {
  tenant: TenantRow | null;
  mode: Mode;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setReason('');
      setErr(null);
    }
  }, [open]);

  if (!tenant) return null;
  const suspending = mode === 'suspend';

  async function submit() {
    if (!tenant) return;
    if (reason.trim().length < 5) {
      setErr('A reason of at least 5 characters is required.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await platformApi.setStatus(tenant.id, suspending ? 'SUSPENDED' : 'ACTIVE', reason.trim());
      toast({ title: suspending ? 'Tenant suspended' : 'Tenant resumed' });
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
          title={suspending ? 'Suspend tenant' : 'Resume tenant'}
          description={tenant.name}
          onClose={() => onOpenChange(false)}
        />

        {suspending ? (
          <div className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <strong className="font-semibold">High-impact.</strong> All{' '}
            <strong className="font-semibold">{tenant.employeeCount}</strong> user
            {tenant.employeeCount === 1 ? '' : 's'} of {tenant.name} lose access immediately, on
            their next request. Existing sessions included.
          </div>
        ) : (
          <p className="mb-4 text-sm text-muted-foreground">
            Access is restored for every user of {tenant.name} on their next request.
          </p>
        )}

        <div className="mb-4 flex flex-col gap-1.5">
          <Label htmlFor="suspend-reason">Reason (recorded in the platform audit log)</Label>
          <Textarea
            id="suspend-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              suspending
                ? 'e.g. Delinquent account past the 60-day grace period.'
                : 'e.g. Payment received; reinstating access.'
            }
          />
        </div>

        {err && <p className="mb-3 text-sm text-destructive">{err}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={suspending ? 'destructive' : 'success'}
            onClick={submit}
            disabled={busy || reason.trim().length < 5}
          >
            {busy ? '…' : suspending ? 'Suspend' : 'Resume'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
