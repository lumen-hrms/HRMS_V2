import * as React from 'react';
import { KeyRound } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { accessApi, AccessRuleError } from '@/lib/access/client';
import type { AccessUser } from '@/lib/access/types';
import { useAccessCtx } from '../use-access-ctx';

/**
 * Send a password-reset link — `POST /api/access/users/:id/password-reset`
 * (planned). Triggers Firebase's hosted reset email; the app never sees or
 * sets the password. Company Admin + HR Manager.
 */
export function SendResetDialog({
  user,
  open,
  onOpenChange,
  onDone,
}: {
  user: AccessUser | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const ctx = useAccessCtx();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) setError(null);
  }, [open, user?.id]);

  if (!user || !ctx) return null;

  async function submit() {
    if (!ctx || !user) return;
    setBusy(true);
    setError(null);
    try {
      await accessApi.sendPasswordReset(user.id, ctx);
      toast({ title: 'Reset link sent', description: `Firebase emailed a reset link to ${user.email}.` });
      onDone();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof AccessRuleError ? err.message : 'Couldn’t send the link — retry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title="Send password-reset link"
          description={user.email}
          onClose={() => onOpenChange(false)}
        />
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2 rounded-md bg-accent px-3 py-2 text-xs text-muted-foreground">
            <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Sends Firebase’s hosted reset email to <span className="font-medium text-foreground">{user.email}</span>.
              The link expires per Firebase policy. This app never sees the password.
            </span>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={busy}>
              {busy ? 'Sending…' : 'Send reset link'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
