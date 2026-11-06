import * as React from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/auth-context';

import { bannerFor, type WorkspaceStatus } from './workspace-banner-logic';

/** Trial / failed-payment / read-only notice shown above every page. */
export function WorkspaceBanner() {
  const { user } = useAuth();
  const [status, setStatus] = React.useState<WorkspaceStatus | null>(null);

  React.useEffect(() => {
    let live = true;
    api
      .get<WorkspaceStatus>('/auth/workspace-status')
      .then((s) => live && setStatus(s))
      .catch(() => live && setStatus(null)); // a banner must never break the page
    return () => {
      live = false;
    };
  }, [user?.sub]);

  const banner = bannerFor(status, user?.role === 'COMPANY_ADMIN');
  if (!banner) return null;
  const Icon = banner.tone === 'warn' ? AlertTriangle : Info;
  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-2 border-b px-8 py-2.5 text-sm',
        banner.tone === 'warn'
          ? 'border-warning/30 bg-warning/10 text-warning'
          : 'border-border bg-muted text-foreground',
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{banner.text}</span>
    </div>
  );
}
