import * as React from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, LogIn, ShieldCheck } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { accessApi } from '@/lib/access/client';
import type { AccessUser } from '@/lib/access/types';
import { RoleBadge, UserStatusBadge, fmtDateTimeIST, fmtDateIST, fmtRelative } from '../shared';

type Activity = Awaited<ReturnType<typeof accessApi.recentActivityFor>>;

/**
 * User Detail slide-over — opened from any Users row.
 * Footer controls are gated by the caller: Company Admin gets all three,
 * HR Manager gets status + reset (no role change), Auditor gets none.
 */
export function UserDetailSheet({
  user,
  open,
  onOpenChange,
  canManage,
  canChangeRole,
  onChangeRole,
  onToggleStatus,
  onSendReset,
}: {
  user: AccessUser | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  canManage: boolean;
  canChangeRole: boolean;
  onChangeRole: () => void;
  onToggleStatus: () => void;
  onSendReset: () => void;
}) {
  const [activity, setActivity] = React.useState<Activity | null>(null);

  React.useEffect(() => {
    if (!open || !user) return;
    setActivity(null);
    accessApi.recentActivityFor(user.id, user.email).then(setActivity);
  }, [open, user?.id]);

  if (!user) return null;

  const showFooter = canManage || canChangeRole;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={user.employee ? `${user.employee.firstName} ${user.employee.lastName}` : user.email}
      description={user.employee?.designation ?? 'No linked employee record'}
      footer={
        showFooter ? (
          <div className="flex flex-wrap justify-end gap-2">
            {canChangeRole && (
              <Button variant="outline" size="sm" onClick={onChangeRole}>
                Change role
              </Button>
            )}
            {canManage && (
              <Button variant="outline" size="sm" onClick={onSendReset}>
                Send reset link
              </Button>
            )}
            {canManage &&
              (user.isActive ? (
                <Button variant="destructive" size="sm" onClick={onToggleStatus}>
                  Deactivate login
                </Button>
              ) : (
                <Button size="sm" onClick={onToggleStatus}>
                  Reactivate login
                </Button>
              ))}
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <RoleBadge role={user.role} />
          <UserStatusBadge isActive={user.isActive} />
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Row label="Email" value={user.email} span />
          <Row
            label="Linked employee"
            span
            value={
              user.employee ? (
                <span className="inline-flex items-center gap-2">
                  {user.employee.employeeCode} · {user.employee.department ?? '—'}
                  <Link
                    to={`/employees/${user.employee.id}`}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    View profile <ExternalLink className="h-3 w-3" />
                  </Link>
                </span>
              ) : (
                <span className="text-muted-foreground">— none —</span>
              )
            }
          />
          <Row label="Member since" value={fmtDateIST(user.createdAt)} />
          <Row
            label="Last sign-in"
            value={user.lastLoginAt ? `${fmtRelative(user.lastLoginAt)}` : 'Never'}
          />
          {user.lastLoginAt && (
            <Row
              label="Last session"
              span
              value={`${user.lastLoginDevice ?? 'Unknown device'} · ${user.lastLoginIp ?? '—'} · ${fmtDateTimeIST(user.lastLoginAt)}`}
            />
          )}
        </dl>

        <div className="rounded-md border border-border bg-muted/40 p-3">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" /> Security
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-muted-foreground">Firebase UID</span>
            <span className="truncate font-mono">{user.firebaseUid}</span>
            <span className="text-muted-foreground">Firebase account</span>
            <span>{user.firebaseDisabled ? 'Disabled' : 'Enabled'}</span>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recent activity
          </p>
          {activity == null ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : activity.length === 0 ? (
            <p className="text-xs text-muted-foreground">No recorded activity yet.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {activity.map((a, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    {a.kind === 'login' ? (
                      <LogIn className="h-3 w-3" />
                    ) : (
                      <ShieldCheck className="h-3 w-3" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium">{a.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {a.detail} · {fmtRelative(a.at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function Row({
  label,
  value,
  span,
}: {
  label: string;
  value: React.ReactNode;
  span?: boolean;
}) {
  return (
    <div className={span ? 'col-span-2' : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium text-foreground">{value}</dd>
    </div>
  );
}
