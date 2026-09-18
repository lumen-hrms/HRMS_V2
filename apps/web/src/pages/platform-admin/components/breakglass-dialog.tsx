import * as React from 'react';
import { ShieldAlert } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { platformApi, isPlatformApiError } from '@/lib/platform-api';
import type { TenantRow } from '../lib/types';

const TTLS = [15, 30, 60, 120];

/**
 * Request time-boxed, read-only, fully-audited support access to one tenant.
 * `POST /api/platform-admin/tenants/:id/breakglass` creates the auditable
 * grant record; it does not itself widen the platform role's DB grants —
 * see the migration comment on `platform.break_glass_grants`.
 */
export function BreakGlassDialog({
  tenant,
  open,
  onOpenChange,
  onGranted,
}: {
  tenant: TenantRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onGranted: (expiresAt: string) => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = React.useState('');
  const [ttl, setTtl] = React.useState(60);
  const [step, setStep] = React.useState<'form' | 'confirm'>('form');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setReason('');
      setTtl(60);
      setStep('form');
      setErr(null);
    }
  }, [open]);

  if (!tenant) return null;

  async function submit() {
    if (!tenant) return;
    setBusy(true);
    setErr(null);
    try {
      const grant = await platformApi.requestBreakGlass(tenant.id, reason.trim(), ttl);
      toast({ title: 'Break-glass access granted' });
      onOpenChange(false);
      onGranted(grant.expiresAt);
    } catch (e) {
      setErr(isPlatformApiError(e) ? e.message : 'Request failed — retry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title="Request break-glass access"
          description={tenant.name}
          onClose={() => onOpenChange(false)}
        />

        {step === 'form' ? (
          <>
            <div className="mb-4 flex flex-col gap-1.5">
              <Label htmlFor="bg-reason">Justification (min 10 chars, audited)</Label>
              <Textarea
                id="bg-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Sev-1: investigating a payroll export lock the customer reported at 14:05 IST."
              />
            </div>
            <div className="mb-4 flex flex-col gap-1.5">
              <Label htmlFor="bg-ttl">Access window</Label>
              <Select id="bg-ttl" value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
                {TTLS.map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => setStep('confirm')} disabled={reason.trim().length < 10}>
                Continue
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-4 flex items-start gap-3 rounded-lg bg-warning/10 p-3 text-sm text-warning">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                You will get <strong>read-only</strong>, <strong>time-boxed</strong>,
                fully-audited access to {tenant.name} for <strong>{ttl} minutes</strong>. Every read
                is recorded. Access auto-expires.
              </span>
            </div>
            {err && <p className="mb-3 text-sm text-destructive">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep('form')} disabled={busy}>
                Back
              </Button>
              <Button onClick={submit} disabled={busy}>
                {busy ? '…' : 'Request access'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
