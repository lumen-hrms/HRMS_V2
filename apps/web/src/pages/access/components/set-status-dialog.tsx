import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { accessApi, AccessRuleError } from '@/lib/access/client';
import type { AccessUser } from '@/lib/access/types';
import { useAccessCtx } from '../use-access-ctx';

/**
 * Activate / deactivate a login — `PATCH /api/access/users/:id/status`
 * (planned). Company Admin + HR Manager. Deactivation is checked on every
 * request against the `users` row (RULE-5), so it bites on the target's next
 * call — no wait for token expiry. Hard blocks: can't deactivate yourself,
 * can't remove the last active Company Admin.
 */
export function SetStatusDialog({
  user,
  mode,
  isSelf,
  activeCompanyAdmins,
  open,
  onOpenChange,
  onDone,
}: {
  user: AccessUser | null;
  mode: 'deactivate' | 'reactivate';
  isSelf: boolean;
  activeCompanyAdmins: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const ctx = useAccessCtx();
  const { toast } = useToast();
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const deactivating = mode === 'deactivate';

  React.useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open, user?.id]);

  if (!user || !ctx) return null;

  const blockSelf = deactivating && isSelf;
  const blockLastAdmin =
    deactivating && user.role === 'COMPANY_ADMIN' && user.isActive && activeCompanyAdmins <= 1;
  const reasonTooShort = reason.trim().length < 5;
  const blocked = blockSelf || blockLastAdmin || reasonTooShort;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (blocked || !ctx || !user) return;
    setBusy(true);
    setError(null);
    try {
      await accessApi.setStatus({ userId: user.id, isActive: !deactivating, reason }, ctx);
      toast({
        title: deactivating ? 'Login deactivated' : 'Login reactivated',
        description: user.email,
      });
      onDone();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof AccessRuleError ? err.message : 'Action failed — retry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={deactivating ? 'Deactivate login' : 'Reactivate login'}
          description={user.email}
          onClose={() => onOpenChange(false)}
        />
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div
            className={
              deactivating
                ? 'flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive'
                : 'flex items-start gap-2 rounded-md bg-accent px-3 py-2 text-xs text-muted-foreground'
            }
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {deactivating
                ? 'They lose portal and API access on their next request. Any open session stops working as soon as its token is re-checked; token refresh then fails in Firebase.'
                : 'Access is restored on their next sign-in and the Firebase user is re-enabled.'}
            </span>
          </div>

          {blockSelf && (
            <p className="text-xs text-destructive">You can’t deactivate your own account.</p>
          )}
          {blockLastAdmin && (
            <p className="text-xs text-destructive">
              A workspace must keep at least one active Company Admin.
            </p>
          )}

          <Field
            label="Reason"
            required
            hint="Recorded in the access audit trail. Minimum 5 characters."
            error={reason.length > 0 && reasonTooShort ? 'Add a bit more detail.' : null}
          >
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                deactivating
                  ? 'e.g. Offboarding — last working day 30 Sep, cleared by manager.'
                  : 'e.g. Returned from sabbatical.'
              }
            />
          </Field>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={deactivating ? 'destructive' : 'default'}
              disabled={busy || blocked}
            >
              {busy
                ? deactivating
                  ? 'Deactivating…'
                  : 'Reactivating…'
                : deactivating
                  ? 'Deactivate login'
                  : 'Reactivate login'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
