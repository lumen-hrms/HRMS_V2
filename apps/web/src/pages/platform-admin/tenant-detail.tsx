import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ExternalLink,
  MoreVertical,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import { platformApi, isPlatformApiError } from '@/lib/platform-api';
import {
  AUDIT_ACTION_LABEL,
  PLAN_LABEL,
  effectivePlan,
  type PlatformAuditEntry,
  type TenantRow,
} from './lib/types';
import { inr, moduleLabel, monthlyTotal } from './lib/plan-catalog';
import { fmtDate, fmtDateTime } from './lib/format';
import { TenantStatusPill } from './components/tenant-status-pill';
import { SeatPressureBar } from './components/seat-pressure-bar';
import { SuspendDialog } from './components/suspend-dialog';
import { ChangePlanDialog } from './components/change-plan-dialog';
import { AdjustPricingDialog } from './components/adjust-pricing-dialog';
import { BreakGlassDialog } from './components/breakglass-dialog';
import { BreakGlassStatusSheet } from './components/breakglass-status-sheet';
import type { BreakGlassGrant } from './lib/types';

type Tab = 'overview' | 'subscription' | 'activity' | 'danger';
type Dialog = 'suspend' | 'resume' | 'plan' | 'pricing' | 'breakglass' | null;

export function TenantDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { toast } = useToast();
  const [tenant, setTenant] = React.useState<TenantRow | null>(null);
  const [state, setState] = React.useState<'loading' | 'ok' | 'notfound'>('loading');
  const [tab, setTab] = React.useState<Tab>('overview');
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [busy, setBusy] = React.useState(false);
  const [activeGrant, setActiveGrant] = React.useState<BreakGlassGrant | null>(null);
  const [showGrantStatus, setShowGrantStatus] = React.useState(false);

  const loadActiveGrant = React.useCallback(() => {
    platformApi
      .getActiveBreakGlass(id)
      .then(setActiveGrant)
      .catch(() => setActiveGrant(null));
  }, [id]);

  const load = React.useCallback(() => {
    setState('loading');
    // Falls back to the list if the detail lookup ever fails (e.g. a stale
    // id) rather than dead-ending on a blank page.
    platformApi
      .getTenant(id)
      .then((d) => {
        setTenant(d);
        setState('ok');
      })
      .catch(() =>
        platformApi
          .listTenants()
          .then((list) => {
            const found = list.find((t) => t.id === id) ?? null;
            setTenant(found);
            setState(found ? 'ok' : 'notfound');
          })
          .catch(() => setState('notfound')),
      );
    loadActiveGrant();
  }, [id, loadActiveGrant]);
  React.useEffect(load, [load]);

  if (state === 'loading') {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (state === 'notfound' || !tenant) {
    return (
      <EmptyState
        title="Tenant not found"
        description="It may have been removed, or the id is wrong."
        action={
          <Button size="sm" variant="outline" onClick={() => nav('/platform-admin')}>
            Back to tenants
          </Button>
        }
      />
    );
  }

  const sub = tenant.subscription;
  const suspended = tenant.status === 'SUSPENDED';

  async function renew() {
    setBusy(true);
    try {
      await platformApi.renew(tenant!.id);
      toast({ title: 'Subscription renewed', description: 'Latest plan terms applied.' });
      load();
    } catch (e) {
      toast({
        title: isPlatformApiError(e) ? e.message : 'Renew failed — retry',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  async function refreshHeadcount() {
    setBusy(true);
    try {
      const { employeeCount } = await platformApi.refreshHeadcount(tenant!.id);
      toast({ title: 'Headcount refreshed', description: `${employeeCount} employees` });
      load();
    } catch (e) {
      toast({
        title: isPlatformApiError(e) ? e.message : 'Refresh failed',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  async function resendAdminReset() {
    setBusy(true);
    try {
      const { email } = await platformApi.resendAdminReset(tenant!.id);
      toast({ title: 'Reset email re-sent', description: email });
    } catch (e) {
      toast({
        title: isPlatformApiError(e) ? e.message : 'Could not send the reset email — retry',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={tenant.name}
        actions={
          <Button variant="ghost" size="sm" onClick={() => nav('/platform-admin')}>
            <ArrowLeft className="h-4 w-4" /> All tenants
          </Button>
        }
      />

      {/* Header card */}
      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <TenantStatusPill status={tenant.status} />
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">
            {PLAN_LABEL[effectivePlan(tenant)]} plan
          </span>
          <a
            href={`https://${tenant.subdomain}.hrms-platform.com`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
          >
            {tenant.subdomain}.hrms-platform.com <ExternalLink className="h-3 w-3" />
          </a>
          <span className="text-xs text-muted-foreground">Created {fmtDate(tenant.createdAt)}</span>

          <div className="ml-auto">
            <DropdownMenu
              trigger={
                <span className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-accent">
                  <MoreVertical className="h-4 w-4" /> Actions
                </span>
              }
            >
              <DropdownMenuItem onClick={() => setDialog('plan')}>Change plan</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDialog('pricing')}>Adjust pricing</DropdownMenuItem>
              <DropdownMenuItem disabled={busy} onClick={renew}>
                <RefreshCw className="h-3.5 w-3.5" /> Renew (apply latest plan terms)
              </DropdownMenuItem>
              <DropdownMenuItem disabled={busy} onClick={refreshHeadcount}>
                <RefreshCw className="h-3.5 w-3.5" /> Refresh headcount
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => (activeGrant ? setShowGrantStatus(true) : setDialog('breakglass'))}
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                {activeGrant ? 'Break-glass access (active)' : 'Break-glass access'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {suspended ? (
                <DropdownMenuItem onClick={() => setDialog('resume')}>Resume tenant</DropdownMenuItem>
              ) : (
                <DropdownMenuItem destructive onClick={() => setDialog('suspend')}>
                  Suspend tenant
                </DropdownMenuItem>
              )}
            </DropdownMenu>
          </div>
        </div>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="subscription">Subscription</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="danger">Danger zone</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Meta label="Status" value={<TenantStatusPill status={tenant.status} />} />
            <Meta label="Plan" value={PLAN_LABEL[effectivePlan(tenant)]} />
            <Meta label="Employees" value={String(tenant.employeeCount)} />
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Seats</p>
              <div className="mt-1.5">
                <SeatPressureBar employeeCount={tenant.employeeCount} seats={sub?.seats} />
              </div>
            </Card>
            <Meta label="Renews" value={fmtDate(sub?.renewsAt)} />
            <Meta
              label="First admin"
              value={
                'firstAdminEmail' in tenant && (tenant as { firstAdminEmail?: string }).firstAdminEmail
                  ? (tenant as { firstAdminEmail?: string }).firstAdminEmail!
                  : '—'
              }
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            disabled={busy}
            onClick={resendAdminReset}
          >
            Resend admin password-reset email
          </Button>
          <p className="mt-4 text-xs text-muted-foreground">
            Headcount trend is one data point today (no time-series table yet) — this console
            shows counts and metadata only, never employee names.
          </p>
        </TabsContent>

        {/* Subscription */}
        <TabsContent value="subscription">
          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="flex flex-col gap-3 p-5">
              <p className="text-sm font-semibold">Plan</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold">{PLAN_LABEL[effectivePlan(tenant)]}</span>
                {sub?.pricePerSeat != null && (
                  <span className="text-sm text-muted-foreground">
                    {inr(sub.pricePerSeat)}/seat/mo
                  </span>
                )}
              </div>
              {sub?.pricePerSeat != null && (
                <p className="text-sm">
                  <span className="font-semibold">
                    {inr(monthlyTotal(sub.pricePerSeat, sub.seats))}/mo
                  </span>{' '}
                  <span className="text-muted-foreground">
                    ({inr(sub.pricePerSeat)} × {sub.seats} seats)
                  </span>
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Seats {sub?.seats ?? '—'} · {sub?.isolationTier === 'DEDICATED' ? 'dedicated DB' : 'pooled'}{' '}
                · renews {fmtDate(sub?.renewsAt)}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setDialog('plan')}>
                  Change plan
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDialog('pricing')}>
                  Adjust pricing
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={renew}>
                  Renew
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                The per-seat rate is negotiated per tenant and snapshotted — a later catalog edit
                doesn’t change it. Renewal keeps the negotiated rate and refreshes modules. No
                billing integration.
              </p>
            </Card>

            <Card className="flex flex-col gap-2 p-5">
              <p className="text-sm font-semibold">Enabled modules</p>
              <ul className="flex flex-col gap-1 text-sm">
                {(sub?.enabledModules ?? []).map((m) => (
                  <li key={m} className="text-muted-foreground">
                    • {moduleLabel(m)}
                  </li>
                ))}
                {(sub?.enabledModules ?? []).length === 0 && (
                  <li className="text-muted-foreground">—</li>
                )}
              </ul>
              <p className="mt-2 text-sm font-semibold">Feature flags</p>
              <ul className="flex flex-col gap-1 text-sm">
                {Object.entries(sub?.features ?? {}).map(([k, v]) => (
                  <li key={k} className="flex items-center gap-2 text-muted-foreground">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${v ? 'bg-success' : 'bg-muted-foreground/40'}`}
                    />
                    {k} — {v ? 'on' : 'off'}
                  </li>
                ))}
                {Object.keys(sub?.features ?? {}).length === 0 && (
                  <li className="text-muted-foreground">—</li>
                )}
              </ul>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Read-only — entitlements are derived from the plan.
              </p>
            </Card>
          </div>
        </TabsContent>

        {/* Activity */}
        <TabsContent value="activity">
          <ActivityTab tenantId={tenant.id} />
        </TabsContent>

        {/* Danger zone */}
        <TabsContent value="danger">
          <div className="flex flex-col gap-3">
            <Card className="flex flex-wrap items-center justify-between gap-3 border-destructive/30 p-4">
              <div>
                <p className="text-sm font-semibold">
                  {suspended ? 'Resume tenant' : 'Suspend tenant'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {suspended
                    ? 'Restore access for every user on their next request.'
                    : `Immediately locks out all ${tenant.employeeCount} users. Reversible.`}
                </p>
              </div>
              <Button
                variant={suspended ? 'success' : 'destructive'}
                size="sm"
                onClick={() => setDialog(suspended ? 'resume' : 'suspend')}
              >
                {suspended ? 'Resume' : 'Suspend'}
              </Button>
            </Card>
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4 opacity-70">
              <div>
                <p className="text-sm font-semibold">Cancel tenant</p>
                <p className="text-xs text-muted-foreground">
                  Retention &amp; export flow not built — TODO(api).
                </p>
              </div>
              <Button variant="outline" size="sm" disabled>
                Cancel tenant
              </Button>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <SuspendDialog
        tenant={dialog === 'suspend' || dialog === 'resume' ? tenant : null}
        mode={dialog === 'resume' ? 'resume' : 'suspend'}
        open={dialog === 'suspend' || dialog === 'resume'}
        onOpenChange={(v) => !v && setDialog(null)}
        onDone={load}
      />
      <ChangePlanDialog
        tenant={dialog === 'plan' ? tenant : null}
        open={dialog === 'plan'}
        onOpenChange={(v) => !v && setDialog(null)}
        onDone={load}
      />
      <AdjustPricingDialog
        tenant={dialog === 'pricing' ? tenant : null}
        open={dialog === 'pricing'}
        onOpenChange={(v) => !v && setDialog(null)}
        onDone={load}
      />
      <BreakGlassDialog
        tenant={dialog === 'breakglass' ? tenant : null}
        open={dialog === 'breakglass'}
        onOpenChange={(v) => !v && setDialog(null)}
        onGranted={() => {
          setDialog(null);
          loadActiveGrant();
        }}
      />
      <BreakGlassStatusSheet
        tenantId={tenant.id}
        grant={activeGrant}
        open={showGrantStatus}
        onOpenChange={setShowGrantStatus}
        onRevoked={() => {
          setShowGrantStatus(false);
          loadActiveGrant();
        }}
      />
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </Card>
  );
}

function ActivityTab({ tenantId }: { tenantId: string }) {
  const [rows, setRows] = React.useState<PlatformAuditEntry[] | null>(null);
  const [notWired, setNotWired] = React.useState(false);

  React.useEffect(() => {
    platformApi
      .getAudit({ tenantId })
      .then(setRows)
      .catch(() => {
        setRows([]);
        setNotWired(true);
      });
  }, [tenantId]);

  if (rows == null) return <Skeleton className="h-32 w-full" />;
  if (notWired || rows.length === 0) {
    return (
      <EmptyState
        title={notWired ? 'Activity feed not wired yet' : 'No recorded activity'}
        description={
          notWired
            ? 'GET /api/platform-admin/audit is TODO(api). Status changes are already written to platform_audit_log — the read endpoint is pending.'
            : undefined
        }
      />
    );
  }
  return (
    <Card className="overflow-hidden">
      <Table>
        <THead>
          <TR>
            <TH>When</TH>
            <TH>Actor</TH>
            <TH>Action</TH>
            <TH>Change</TH>
            <TH>Note</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.at)}</TD>
              <TD>{r.actorEmail}</TD>
              <TD>{AUDIT_ACTION_LABEL[r.action]}</TD>
              <TD className="text-muted-foreground">
                {r.before && r.after ? `${r.before} → ${r.after}` : '—'}
              </TD>
              <TD className="max-w-xs text-xs text-muted-foreground">{r.note ?? '—'}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}
