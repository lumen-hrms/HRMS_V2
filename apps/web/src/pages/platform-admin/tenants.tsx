import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Building2,
  CheckCircle2,
  Download,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import { platformApi, isPlatformApiError } from '@/lib/platform-api';
import {
  PLAN_LABEL,
  effectivePlan,
  seatPressure,
  type TenantRow,
  type TenantStatus,
} from './lib/types';
import { fmtDate, fmtUntil } from './lib/format';
import { TenantStatusPill } from './components/tenant-status-pill';
import { SeatPressureBar } from './components/seat-pressure-bar';
import { SuspendDialog } from './components/suspend-dialog';
import { ChangePlanDialog } from './components/change-plan-dialog';

const PAGE = 25;
type Dialog = { kind: 'suspend' | 'resume' | 'plan'; tenant: TenantRow } | null;

export function TenantsPage() {
  const nav = useNavigate();
  const { toast } = useToast();
  const [rows, setRows] = React.useState<TenantRow[] | null>(null);
  const [loadErr, setLoadErr] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState<TenantStatus | 'ALL'>('ALL');
  const [plan, setPlan] = React.useState<string>('ALL');
  const [page, setPage] = React.useState(0);
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [refreshing, setRefreshing] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setRows(null);
    setLoadErr(false);
    platformApi
      .listTenants()
      .then(setRows)
      .catch(() => {
        setRows([]);
        setLoadErr(true);
      });
  }, []);
  React.useEffect(load, [load]);

  const all = rows ?? [];
  const stats = {
    total: all.length,
    active: all.filter((t) => t.status === 'ACTIVE').length,
    trial: all.filter((t) => t.status === 'TRIAL').length,
    suspended: all.filter((t) => t.status === 'SUSPENDED').length,
    overSeat: all.filter((t) => seatPressure(t.employeeCount, t.subscription?.seats).over).length,
  };

  const filtered = all.filter((t) => {
    if (status !== 'ALL' && t.status !== status) return false;
    if (plan !== 'ALL' && effectivePlan(t) !== plan) return false;
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      if (!`${t.name} ${t.subdomain}`.toLowerCase().includes(n)) return false;
    }
    return true;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE, safePage * PAGE + PAGE);
  React.useEffect(() => setPage(0), [q, status, plan]);

  async function refreshHeadcount(t: TenantRow) {
    setRefreshing(t.id);
    try {
      await platformApi.refreshHeadcount(t.id);
      toast({ title: 'Headcount refreshed' });
      load();
    } catch (e) {
      toast({
        title:
          isPlatformApiError(e) && e.status === 404
            ? 'Headcount-refresh API not wired yet'
            : 'Refresh failed — retry',
        tone: 'info',
      });
    } finally {
      setRefreshing(null);
    }
  }

  function exportCsv() {
    const head = ['Name', 'Subdomain', 'Status', 'Plan', 'Employees', 'Seats', 'Renews', 'Created'];
    const lines = filtered.map((t) =>
      [
        t.name,
        t.subdomain,
        t.status,
        PLAN_LABEL[effectivePlan(t)],
        t.employeeCount,
        t.subscription?.seats ?? '',
        t.subscription?.renewsAt ? fmtDate(t.subscription.renewsAt) : '',
        fmtDate(t.createdAt),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tenants-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Tenants"
        description="Every customer workspace — counts and metadata only, no tenant data."
        actions={
          <Button onClick={() => nav('/platform-admin/tenants/new')}>
            <Plus className="h-4 w-4" /> New tenant
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat icon={Building2} label="Total" value={rows ? stats.total : null} />
        <Stat icon={CheckCircle2} label="Active" value={rows ? stats.active : null} tone="success" />
        <Stat label="On trial" value={rows ? stats.trial : null} tone="warning" />
        <Stat label="Suspended" value={rows ? stats.suspended : null} tone={stats.suspended ? 'destructive' : undefined} />
        <Stat
          icon={ShieldAlert}
          label="Over seat limit"
          value={rows ? stats.overSeat : null}
          tone={stats.overSeat ? 'destructive' : undefined}
        />
      </div>

      <Card className="flex flex-wrap items-end gap-3 p-3">
        <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Search
          <span className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-8 pl-7" placeholder="Name or subdomain…" value={q} onChange={(e) => setQ(e.target.value)} />
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Status
          <Select className="h-8 w-36" value={status} onChange={(e) => setStatus(e.target.value as TenantStatus | 'ALL')}>
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="TRIAL">Trial</option>
            <option value="SUSPENDED">Suspended</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Plan
          <Select className="h-8 w-36" value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="ALL">All plans</option>
            {(['TRIAL', 'STARTER', 'GROWTH', 'ENTERPRISE'] as const).map((p) => (
              <option key={p} value={p}>
                {PLAN_LABEL[p]}
              </option>
            ))}
          </Select>
        </label>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </Card>

      <Card className="overflow-hidden">
        {rows == null ? (
          <div className="p-4">
            <SkeletonRows rows={8} />
          </div>
        ) : loadErr ? (
          <EmptyState
            icon={Building2}
            title="Couldn’t load tenants"
            description="The platform API didn’t respond."
            action={
              <Button size="sm" variant="outline" onClick={load}>
                Retry
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={all.length === 0 ? 'No tenants yet' : 'No tenants match these filters'}
            action={
              all.length === 0 ? (
                <Button size="sm" onClick={() => nav('/platform-admin/tenants/new')}>
                  New tenant
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Tenant</TH>
                <TH>Status</TH>
                <TH>Plan</TH>
                <TH className="w-52">Seats</TH>
                <TH>Renews / Trial ends</TH>
                <TH>Created</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {pageRows.map((t) => {
                const until = fmtUntil(t.subscription?.renewsAt ?? null);
                const trialChip =
                  t.status === 'TRIAL' && until && until.days >= 0 && until.days <= 7
                    ? `ends ${until.text}`
                    : undefined;
                return (
                  <TR
                    key={t.id}
                    className="cursor-pointer hover:bg-accent"
                    onClick={() => nav(`/platform-admin/tenants/${t.id}`)}
                  >
                    <TD>
                      <div className="font-medium">{t.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{t.subdomain}</div>
                    </TD>
                    <TD>
                      <TenantStatusPill status={t.status} sub={trialChip} />
                    </TD>
                    <TD>{PLAN_LABEL[effectivePlan(t)]}</TD>
                    <TD>
                      <SeatPressureBar
                        employeeCount={t.employeeCount}
                        seats={t.subscription?.seats}
                      />
                    </TD>
                    <TD className="text-muted-foreground">
                      {t.subscription?.renewsAt ? fmtDate(t.subscription.renewsAt) : '—'}
                    </TD>
                    <TD className="text-muted-foreground">{fmtDate(t.createdAt)}</TD>
                    <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu
                        trigger={
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                            <MoreHorizontal className="h-4 w-4" />
                          </span>
                        }
                      >
                        <DropdownMenuItem onClick={() => nav(`/platform-admin/tenants/${t.id}`)}>
                          View
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDialog({ kind: 'plan', tenant: t })}>
                          Change plan
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={refreshing === t.id}
                          onClick={() => refreshHeadcount(t)}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          {refreshing === t.id ? 'Refreshing…' : 'Refresh headcount'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {t.status === 'SUSPENDED' ? (
                          <DropdownMenuItem onClick={() => setDialog({ kind: 'resume', tenant: t })}>
                            Resume tenant
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            destructive
                            onClick={() => setDialog({ kind: 'suspend', tenant: t })}
                          >
                            Suspend tenant
                          </DropdownMenuItem>
                        )}
                      </DropdownMenu>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>

      {rows != null && filtered.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {safePage * PAGE + 1}–{safePage * PAGE + pageRows.length} of {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span>
              Page {safePage + 1} of {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {loadErr && (
        <p className="text-xs text-muted-foreground">
          <Link to="/platform-admin/tenants/new" className="text-primary hover:underline">
            Create the first tenant
          </Link>{' '}
          once the API is reachable.
        </p>
      )}

      <SuspendDialog
        tenant={dialog?.kind === 'suspend' || dialog?.kind === 'resume' ? dialog.tenant : null}
        mode={dialog?.kind === 'resume' ? 'resume' : 'suspend'}
        open={dialog?.kind === 'suspend' || dialog?.kind === 'resume'}
        onOpenChange={(v) => !v && setDialog(null)}
        onDone={load}
      />
      <ChangePlanDialog
        tenant={dialog?.kind === 'plan' ? dialog.tenant : null}
        open={dialog?.kind === 'plan'}
        onOpenChange={(v) => !v && setDialog(null)}
        onDone={load}
      />
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon?: typeof Building2;
  label: string;
  value: number | null;
  tone?: 'success' | 'warning' | 'destructive';
}) {
  const cls =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'destructive'
          ? 'text-destructive'
          : '';
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </span>
      {value == null ? (
        <div className="mt-1 h-8 w-12 animate-pulse rounded bg-muted" />
      ) : (
        <span className={`text-2xl font-semibold ${cls}`}>{value}</span>
      )}
    </Card>
  );
}
