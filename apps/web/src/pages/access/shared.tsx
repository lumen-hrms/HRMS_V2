import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ROLE_LABELS, type Role } from '@/lib/roles';
import {
  ACCESS_ACTION_LABELS,
  LOGIN_OUTCOME_LABELS,
  type AccessAuditAction,
  type LoginOutcome,
} from '@/lib/access/types';

/** "14 Apr 2026, 3:04 pm IST" — timestamps are stored UTC, shown IST. */
export function fmtDateTimeIST(iso: string): string {
  const s = new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${s} IST`;
}

/** "14 Apr 2026 IST" (date only). */
export function fmtDateIST(iso: string): string {
  return `${new Date(iso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })} IST`;
}

/** Coarse relative label for a past ISO timestamp. */
export function fmtRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
  const mon = Math.round(day / 30);
  if (mon < 12) return `${mon} mo ago`;
  return `${Math.round(mon / 12)} yr ago`;
}

/** "eleanor.vance@acme.example" → "Eleanor Vance". Best-effort display name. */
export function humanizeEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return (
    local
      .split(/[.\-_]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ') || email
  );
}

export function RoleBadge({ role }: { role: Role }) {
  return <Badge variant="outline">{ROLE_LABELS[role]}</Badge>;
}

export function UserStatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        isActive ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive',
      )}
    >
      <span
        className={cn('h-1.5 w-1.5 rounded-full', isActive ? 'bg-success' : 'bg-destructive')}
      />
      {isActive ? 'Active' : 'Deactivated'}
    </span>
  );
}

export function OutcomePill({ outcome }: { outcome: LoginOutcome }) {
  const ok = outcome === 'SUCCESS';
  return (
    <Badge variant={ok ? 'success' : 'destructive'}>{LOGIN_OUTCOME_LABELS[outcome]}</Badge>
  );
}

export function AccessActionBadge({ action }: { action: AccessAuditAction }) {
  const tone =
    action === 'user.deactivated'
      ? 'destructive'
      : action === 'user.activated' || action === 'user.created'
        ? 'success'
        : 'outline';
  return <Badge variant={tone}>{ACCESS_ACTION_LABELS[action]}</Badge>;
}

export function MockDataNote() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
      <span className="h-1.5 w-1.5 rounded-full bg-warning" />
      Mock data — access API not wired yet
    </span>
  );
}
