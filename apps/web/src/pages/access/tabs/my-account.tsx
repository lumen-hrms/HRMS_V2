import * as React from 'react';
import { Building2, KeyRound, LogOut, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/context/auth-context';
import { getTenantSubdomain, requestPasswordReset } from '@/lib/api';

import { accessApi } from '@/lib/access/client';
import type { AccessSelf } from '@/lib/access/types';
import { RoleBadge, UserStatusBadge, fmtDateTimeIST, fmtDateIST, fmtRelative, humanizeEmail } from '../shared';

/**
 * My Account — every authenticated persona's own identity view. Read-only:
 * this screen never mutates access. The only action is "Change my password",
 * which sends a Firebase hosted reset email to the signed-in address.
 */
export function MyAccountTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [me, setMe] = React.useState<AccessSelf | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!user) return;
    accessApi
      .getMe()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoaded(true));
  }, [user?.email]);

  if (!user) return null;

  const displayName = me?.employee
    ? `${me.employee.firstName} ${me.employee.lastName}`
    : humanizeEmail(user.email);
  const tenantName = me?.tenantName ?? '—';

  async function changePassword() {
    if (!user) return;
    setBusy(true);
    try {
      const subdomain = getTenantSubdomain();
      if (!subdomain) throw new Error('No workspace selected');
      await requestPasswordReset(subdomain, user.email);
      toast({
        title: 'Password reset email sent to you',
        description: `Check ${user.email} for the link.`,
      });
    } catch {
      toast({ title: 'Couldn’t send the reset email — retry.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UserRound className="h-6 w-6" />
          </span>
          <div>
            <p className="text-base font-semibold">{displayName}</p>
            <p className="text-sm text-muted-foreground">
              {me?.employee?.designation ?? 'Signed-in user'}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <RoleBadge role={user.role} />
            {me && <UserStatusBadge isActive={me.isActive} />}
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Detail icon={Mail} label="Email" value={user.email} />
          <Detail icon={Building2} label="Workspace" value={tenantName} />
          <Detail
            icon={ShieldCheck}
            label="Member since"
            value={
              !loaded ? <Skeleton className="h-4 w-24" /> : me ? fmtDateIST(me.createdAt) : '—'
            }
          />
          <Detail
            icon={ShieldCheck}
            label="Last sign-in"
            value={
              !loaded ? (
                <Skeleton className="h-4 w-32" />
              ) : me?.lastLoginAt ? (
                <span title={fmtDateTimeIST(me.lastLoginAt)}>
                  {fmtRelative(me.lastLoginAt)}
                  {me.lastLoginDevice ? ` · ${me.lastLoginDevice}` : ''}
                </span>
              ) : (
                'This session'
              )
            }
          />
        </dl>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <p className="text-sm font-medium">Security</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={changePassword} disabled={busy}>
            <KeyRound className="h-4 w-4" />
            {busy ? 'Sending…' : 'Change my password'}
          </Button>
          <span
            title="Not available yet — revoking every device session is a planned backend capability."
            className="inline-flex"
          >
            <Button variant="outline" size="sm" disabled>
              <LogOut className="h-4 w-4" /> Sign out everywhere
            </Button>
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          “Change my password” sends a reset link to your email via Firebase — the app never stores
          or sees your password. Your role and access are managed by an administrator and can’t be
          changed here.
        </p>
      </Card>
    </div>
  );
}

function Detail({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div>
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 text-sm font-medium">{value}</dd>
      </div>
    </div>
  );
}
