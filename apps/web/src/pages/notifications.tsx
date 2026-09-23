import * as React from 'react';
import { Mail, RotateCw } from 'lucide-react';
import { api, isApiError } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/context/auth-context';
import { cn } from '@/lib/utils';

type Status = 'QUEUED' | 'SENT' | 'FAILED';

interface LogItem {
  id: string;
  template: string;
  subject: string;
  recipientEmail: string;
  status: Status;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

interface LogResponse {
  counts: Record<Status, number>;
  items: LogItem[];
}

const STATUS_BADGE: Record<Status, { label: string; variant: 'success' | 'warning' | 'destructive' }> = {
  SENT: { label: 'Sent', variant: 'success' },
  QUEUED: { label: 'Queued', variant: 'warning' },
  FAILED: { label: 'Failed', variant: 'destructive' },
};

const FILTERS: (Status | 'ALL')[] = ['ALL', 'FAILED', 'QUEUED', 'SENT'];

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Email log (module 10 §3.3) — every workflow email the platform queued for
 * this tenant, with its delivery state. Company Admin / HR Manager can
 * retry a failed one; Auditor is read-only.
 */
export function NotificationsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [filter, setFilter] = React.useState<Status | 'ALL'>('ALL');
  const [data, setData] = React.useState<LogResponse | null>(null);
  const [retrying, setRetrying] = React.useState<string | null>(null);
  const canRetry = !!user && ['COMPANY_ADMIN', 'HR_MANAGER'].includes(user.role);

  const load = React.useCallback(() => {
    const qs = filter === 'ALL' ? '' : `?status=${filter}`;
    api.get<LogResponse>(`/notifications/log${qs}`).then(setData);
  }, [filter]);
  React.useEffect(load, [load]);

  async function retry(id: string) {
    setRetrying(id);
    try {
      await api.post(`/notifications/log/${id}/retry`);
      toast({ title: 'Email re-queued', tone: 'success' });
      load();
    } catch (err) {
      toast({
        title: 'Could not retry',
        description: isApiError(err) ? err.message : undefined,
        tone: 'error',
      });
    } finally {
      setRetrying(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Email log</h1>
        <p className="text-sm text-muted-foreground">
          Workflow emails sent to your people — leave and attendance decisions, approvals waiting,
          blocked uploads.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-md border px-3 py-1.5 text-xs font-medium',
              filter === f ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent',
            )}
          >
            {f === 'ALL' ? 'All' : STATUS_BADGE[f].label}
            {data && f !== 'ALL' && (
              <span className="ml-1.5 tabular-nums text-muted-foreground">{data.counts[f]}</span>
            )}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        {data == null ? (
          <div className="p-4">
            <SkeletonRows rows={5} />
          </div>
        ) : data.items.length === 0 ? (
          <EmptyState icon={Mail} title="No emails" description="Nothing matches this filter yet." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Email</TH>
                <TH>To</TH>
                <TH>Status</TH>
                <TH>Queued</TH>
                {canRetry && <TH className="text-right">Action</TH>}
              </TR>
            </THead>
            <TBody>
              {data.items.map((item) => (
                <TR key={item.id}>
                  <TD className="max-w-md">
                    <div className="truncate font-medium">{item.subject}</div>
                    {item.status !== 'SENT' && item.lastError && (
                      <div className="truncate text-xs text-destructive" title={item.lastError}>
                        {item.lastError}
                      </div>
                    )}
                  </TD>
                  <TD className="text-sm">{item.recipientEmail}</TD>
                  <TD>
                    <Badge variant={STATUS_BADGE[item.status].variant}>
                      {STATUS_BADGE[item.status].label}
                    </Badge>
                    {item.attempts > 1 && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {item.attempts} tries
                      </span>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap text-sm text-muted-foreground">
                    {fmtDateTime(item.createdAt)}
                  </TD>
                  {canRetry && (
                    <TD className="text-right">
                      {item.status === 'FAILED' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={retrying === item.id}
                          onClick={() => retry(item.id)}
                        >
                          <RotateCw className="h-3.5 w-3.5" /> Retry
                        </Button>
                      )}
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
