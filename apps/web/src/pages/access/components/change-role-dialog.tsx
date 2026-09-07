import * as React from 'react';
import { Info } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { assignableRoles, ROLE_LABELS, type Role } from '@/lib/roles';
import { accessApi, AccessRuleError } from '@/lib/access/client';
import type { AccessUser } from '@/lib/access/types';
import { useAccessCtx } from '../use-access-ctx';
import { RoleBadge } from '../shared';

/**
 * Change Role — `PATCH /api/access/users/:id/role` (planned).
 * Company Admin only (RULE-2). Options are capped at the actor's ceiling;
 * a `reason` (≥ 5 chars) is mandatory for the audit trail; the new role is
 * effective on the target's next token refresh (≤ 1 h) — surfaced inline.
 */
export function ChangeRoleDialog({
  user,
  activeCompanyAdmins,
  open,
  onOpenChange,
  onDone,
}: {
  user: AccessUser | null;
  activeCompanyAdmins: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const ctx = useAccessCtx();
  const { toast } = useToast();
  const options = React.useMemo(() => assignableRoles(ctx), [ctx]);

  const [newRole, setNewRole] = React.useState<Role>('EMPLOYEE');
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open && user) {
      setNewRole(options.find((r) => r !== user.role) ?? user.role);
      setReason('');
      setError(null);
    }
  }, [open, user?.id]);

  if (!user || !ctx) return null;

  const demotingLastAdmin =
    user.role === 'COMPANY_ADMIN' && user.isActive && activeCompanyAdmins <= 1 && newRole !== 'COMPANY_ADMIN';
  const unchanged = newRole === user.role;
  const reasonTooShort = reason.trim().length < 5;
  const blocked = demotingLastAdmin || unchanged || reasonTooShort;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (blocked || !ctx || !user) return;
    setBusy(true);
    setError(null);
    try {
      await accessApi.changeRole({ userId: user.id, newRole, reason }, ctx);
      toast({ title: 'Role updated', description: `${user.email} is now ${ROLE_LABELS[newRole]}.` });
      toast({
        title: 'Role change takes effect on next sign-in',
        tone: 'info',
        description: 'Or within ~1 hour when the ID token refreshes.',
      });
      onDone();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof AccessRuleError ? err.message : 'Couldn’t update role — retry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title="Change role"
          description={user.email}
          onClose={() => onOpenChange(false)}
        />
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
            <span className="text-muted-foreground">Current role</span>
            <RoleBadge role={user.role} />
          </div>

          <Field label="New role" required>
            <Select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
              {options.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          {!options.includes('COMPANY_ADMIN') && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Only a Company Admin can grant the Company Admin role.
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
              placeholder="e.g. Promotion to Head of People Ops, approved by leadership."
            />
          </Field>

          <div className="flex items-start gap-2 rounded-md bg-accent px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Takes effect on {user.email.split('@')[0]}’s next sign-in, or within ~1 hour when their
              Firebase ID token refreshes.
            </span>
          </div>

          {demotingLastAdmin && (
            <p className="text-xs text-destructive">
              A workspace must keep at least one active Company Admin.
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || blocked}>
              {busy ? 'Saving…' : 'Save role'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
