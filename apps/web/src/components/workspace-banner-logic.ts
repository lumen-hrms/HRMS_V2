/** Which trial / payment / read-only notice (if any) the workspace banner shows. */
export interface WorkspaceStatus {
  status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL' | 'READ_ONLY';
  trialEndsAt: string | null;
  graceEndsAt: string | null;
}

const DAY_MS = 86_400_000;
const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Pure so it can be reasoned about: which message (if any) to show. */
export function bannerFor(
  s: WorkspaceStatus | null,
  isAdmin: boolean,
  now: number = Date.now(),
): { tone: 'info' | 'warn'; text: string } | null {
  if (!s) return null;
  const who = isAdmin ? 'Contact us to subscribe' : 'Ask your administrator to subscribe';
  if (s.status === 'READ_ONLY') {
    return {
      tone: 'warn',
      text: `This workspace is read-only. You can view your data but not make changes. ${who} and full access returns straight away.`,
    };
  }
  if (s.status === 'TRIAL' && s.trialEndsAt) {
    const days = Math.max(0, Math.ceil((new Date(s.trialEndsAt).getTime() - now) / DAY_MS));
    return {
      tone: days <= 2 ? 'warn' : 'info',
      text:
        days === 0
          ? `Your trial ends today. After that the workspace becomes read-only. ${who}.`
          : `Your trial ends in ${days} day${days === 1 ? '' : 's'} (${fmt(s.trialEndsAt)}). After that the workspace becomes read-only. ${who}.`,
    };
  }
  if (s.status === 'ACTIVE' && s.graceEndsAt) {
    return {
      tone: 'warn',
      text: `A subscription payment failed. The workspace becomes read-only on ${fmt(s.graceEndsAt)} unless a payment goes through.`,
    };
  }
  return null;
}
