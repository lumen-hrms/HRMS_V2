import * as React from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  Coffee,
  LogIn,
  LogOut,
  RefreshCw,
  Wallet,
  X,
} from 'lucide-react';
import { api, isApiError } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/context/auth-context';
import { Link } from 'react-router-dom';
import { useSetupStatus } from '@/lib/setup-status';
import { setupApi } from '@/lib/setup';
import { AdminOverview, type AdminDashboardData } from '@/pages/dashboard-admin';
import { EmployeeInsightsPanels, LeaveBalanceTile, type EmployeeInsights } from '@/pages/dashboard-employee';
import { ChartLegend, RingChart, TONE_COLOR } from '@/components/charts';
import { dayTotals, formatDuration } from '@/lib/attendance-day';
import { EarlyClockOutDialog } from '@/components/attendance/early-clock-out-dialog';

const APPROVER_ROLES = ['LINE_MANAGER', 'HR_MANAGER', 'COMPANY_ADMIN'];

interface TodayAttendanceSnapshot {
  status: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  /** Today's breaks; an open one has no endAt. Absent from an older API. */
  breaks?: { startAt: string; endAt: string | null }[];
  isOnBreak: boolean;
  effectiveMs: number;
  targetHours: number;
}

type AdminDashboard = AdminDashboardData & { todayAttendance: TodayAttendanceSnapshot | null };

interface EmployeeDashboard {
  view: 'employee';
  leaveBalances: {
    id: string;
    accrued: string;
    carriedForward?: string;
    used: string;
    pending?: string;
    leaveType: { name: string };
  }[];
  pendingApprovals: {
    id: string;
    days: string;
    employee: { firstName: string; lastName: string };
    leaveType: { name: string };
  }[];
  myRecentRequests: { id: string; status: string; days: string; startDate: string }[];
  todayAttendance: TodayAttendanceSnapshot | null;
  /** Absent when the API is older than this screen. */
  insights?: EmployeeInsights;
}

type DashboardData = AdminDashboard | EmployeeDashboard;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function DashboardPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [data, setData] = React.useState<DashboardData | null>(null);
  const [error, setError] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setLoading(true);
    setError(false);
    api
      .get<DashboardData>('/dashboard')
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const runAction = React.useCallback(
    async (key: string, fn: () => Promise<unknown>) => {
      setBusy(key);
      try {
        await fn();
        await load();
      } catch (err) {
        toast({
          title: isApiError(err) ? err.message : 'Action failed',
          tone: 'error',
        });
      } finally {
        setBusy(null);
      }
    },
    [load, toast],
  );

  const decide = (id: string, action: 'approve' | 'reject') =>
    runAction(`${action}-${id}`, async () => {
      await api.post(`/leave/requests/${id}/${action}`);
      toast({
        title: action === 'approve' ? 'Request approved' : 'Request rejected',
        tone: action === 'approve' ? 'success' : 'info',
      });
    });

  if (error) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load your dashboard"
        description="Something went wrong fetching your dashboard data."
        action={
          <Button size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
        }
      />
    );
  }

  if (loading || !data) return <DashboardSkeleton />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{greeting()}</h1>
        <p className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          {' · '}Here's what's happening across your organization.
        </p>
      </div>

      {user?.role === 'COMPANY_ADMIN' && <SetupFollowUps />}

      {data.todayAttendance && (
        <TodayAttendanceCard
          snapshot={data.todayAttendance}
          busy={busy === 'attendance'}
          onAction={(path) => runAction('attendance', () => api.post(path))}
        />
      )}

      {data.view === 'admin' ? (
        <AdminOverview data={data} busyKey={busy} onDecide={decide} />
      ) : (
        <>
        {data.insights && (
          <EmployeeInsightsPanels insights={data.insights} canViewTeam={user?.role === 'EMPLOYEE' || user?.role === 'LINE_MANAGER'} />
        )}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LeaveBalanceTile balances={data.leaveBalances} />

          <Card>
            <CardHeader>
              <CardTitle>Pending approvals</CardTitle>
              <CardDescription>Requests waiting on your decision.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {data.pendingApprovals.length === 0 && (
                <EmptyState icon={CheckCircle2} title="Nothing pending. 🎉" className="py-6" />
              )}
              {data.pendingApprovals.map((r) => (
                <div key={r.id} className="flex items-center gap-3 text-sm">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                    {r.employee.firstName[0]}
                    {r.employee.lastName[0]}
                  </span>
                  <span className="flex-1 truncate">
                    {r.employee.firstName} {r.employee.lastName} · {r.leaveType.name}
                  </span>
                  <Badge variant="warning">{r.days}d</Badge>
                  {user && APPROVER_ROLES.includes(user.role) && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-destructive hover:text-destructive"
                        disabled={busy !== null}
                        onClick={() => decide(r.id, 'reject')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 px-2"
                        disabled={busy !== null}
                        onClick={() => decide(r.id, 'approve')}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>My recent requests</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {data.myRecentRequests.length === 0 && (
                <EmptyState icon={CalendarClock} title="You haven't applied for leave yet" className="py-6" />
              )}
              {data.myRecentRequests.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-sm">
                  <span>{new Date(r.startDate).toLocaleDateString()} · {r.days}d</span>
                  <StatusBadge status={r.status} />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
        </>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-6 w-32" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-8 w-16" />
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}

const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

type AttendanceAction = '/attendance/clock-in' | '/attendance/clock-out' | '/attendance/break/start' | '/attendance/break/end';

function TodayAttendanceCard({
  snapshot,
  busy,
  onAction,
}: {
  snapshot: TodayAttendanceSnapshot;
  busy: boolean;
  onAction: (path: AttendanceAction) => void;
}) {
  const isClockedIn = !!snapshot.checkInAt && !snapshot.checkOutAt;
  const isDayComplete = !!snapshot.checkOutAt;

  // The ring counts on its own while you're clocked in, between refreshes.
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!isClockedIn) return;
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, [isClockedIn]);

  const [confirmingOut, setConfirmingOut] = React.useState(false);

  const breaks = snapshot.breaks ?? [];
  const { workedMs, breakMs, breakCount } = dayTotals({ ...snapshot, breaks }, now);
  const targetMs = snapshot.targetHours * 3_600_000;
  const remainingMs = Math.max(targetMs - workedMs, 0);
  const statusLabel = snapshot.isOnBreak
    ? 'On break'
    : isDayComplete
      ? 'Day complete'
      : snapshot.checkInAt
        ? (snapshot.status ?? 'Present').replace('_', ' ')
        : 'Not clocked in yet';
  const variant =
    !snapshot.checkInAt
      ? 'default'
      : snapshot.status === 'LATE'
        ? 'warning'
        : snapshot.status === 'ABSENT'
          ? 'destructive'
          : 'success';

  return (
    <Card>
      <EarlyClockOutDialog
        open={confirmingOut}
        workedMs={workedMs}
        targetMs={targetMs}
        busy={busy}
        onCancel={() => setConfirmingOut(false)}
        onConfirm={() => {
          setConfirmingOut(false);
          onAction('/attendance/clock-out');
        }}
      />
      <CardHeader className="flex flex-row items-center justify-between">
        <CardDescription>Today's attendance</CardDescription>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant={variant}>{statusLabel}</Badge>
          {!isDayComplete && !isClockedIn && (
            <Button size="sm" disabled={busy} onClick={() => onAction('/attendance/clock-in')}>
              <LogIn className="h-4 w-4" /> Clock in
            </Button>
          )}
          {!isDayComplete && isClockedIn && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => onAction(snapshot.isOnBreak ? '/attendance/break/end' : '/attendance/break/start')}
              >
                <Coffee className="h-4 w-4" /> {snapshot.isOnBreak ? 'End break' : 'Take break'}
              </Button>
              <Button
                size="sm"
                disabled={busy || snapshot.isOnBreak}
                onClick={() => (workedMs < targetMs ? setConfirmingOut(true) : onAction('/attendance/clock-out'))}
              >
                <LogOut className="h-4 w-4" /> Clock out
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-6 sm:flex-row">
        <RingChart
          size={192}
          thickness={20}
          ariaLabel={`${formatDuration(workedMs)} worked, ${formatDuration(breakMs)} on ${breakCount} ${breakCount === 1 ? 'break' : 'breaks'}, ${formatDuration(remainingMs)} left of the ${snapshot.targetHours} hour target`}
          segments={[
            { id: 'worked', label: 'Worked', value: workedMs, tone: 1, display: formatDuration(workedMs) },
            { id: 'breaks', label: 'Breaks', value: breakMs, tone: 2, display: formatDuration(breakMs) },
            { id: 'left', label: 'Left to target', value: remainingMs, tone: 'muted', display: formatDuration(remainingMs) },
          ]}
        >
          <span className="text-3xl font-semibold leading-none">{formatDuration(workedMs)}</span>
          <span className="mt-1.5 text-xs text-muted-foreground">of {snapshot.targetHours}h target</span>
        </RingChart>

        <div className="flex w-full min-w-0 flex-1 flex-col gap-4">
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Clocked in</dt>
              <dd className="mt-0.5 text-lg font-semibold">{snapshot.checkInAt ? clockTime(snapshot.checkInAt) : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Breaks</dt>
              <dd className="mt-0.5 text-lg font-semibold">
                {breakCount === 0 ? 'None' : `${breakCount} · ${formatDuration(breakMs)}`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Clocked out</dt>
              <dd className="mt-0.5 text-lg font-semibold">
                {snapshot.checkOutAt ? clockTime(snapshot.checkOutAt) : isClockedIn ? 'Working' : '—'}
              </dd>
            </div>
          </dl>

          {breaks.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground" aria-label="Today's breaks">
              {breaks.slice(0, 4).map((b, i) => (
                <li key={`${b.startAt}-${i}`}>
                  {clockTime(b.startAt)} – {b.endAt ? clockTime(b.endAt) : 'now'}
                  {b.endAt && ` · ${formatDuration(new Date(b.endAt).getTime() - new Date(b.startAt).getTime())}`}
                </li>
              ))}
              {breaks.length > 4 && <li>+ {breaks.length - 4} more</li>}
            </ul>
          )}

          <ChartLegend
            items={[
              { color: TONE_COLOR[1], label: 'Worked', value: formatDuration(workedMs) },
              { color: TONE_COLOR[2], label: breakCount === 1 ? 'Break' : 'Breaks', value: formatDuration(breakMs) },
              { color: TONE_COLOR.muted, label: 'Left to target', value: formatDuration(remainingMs) },
            ]}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const variant =
    status === 'APPROVED'
      ? 'success'
      : status === 'REJECTED' || status === 'CANCELLED'
        ? 'destructive'
        : 'warning';
  return <Badge variant={variant}>{status.replace('_', ' ')}</Badge>;
}

/**
 * What company setup leaves for later: payroll (deliberately not part of
 * setup) and any imported logins whose provisioning failed after submit.
 */
function SetupFollowUps() {
  const { status, refresh } = useSetupStatus();
  const { toast } = useToast();
  const [retrying, setRetrying] = React.useState(false);
  if (!status) return null;
  const failures = status.loginFailures;

  async function retry() {
    setRetrying(true);
    try {
      const { loginFailures } = await setupApi.retryLogins();
      toast({
        title: loginFailures.length === 0 ? 'All logins created' : `${loginFailures.length} still failing`,
        tone: loginFailures.length === 0 ? 'success' : 'error',
      });
      await refresh();
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Retry failed', tone: 'error' });
    } finally {
      setRetrying(false);
    }
  }

  if (status.payrollConfigured && failures.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {!status.payrollConfigured && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4" /> Set up payroll
            </CardTitle>
            <CardDescription>
              Salary structures, statutory settings and your first run — whenever you’re ready. Days before your go-live
              date have no attendance, so they count as worked in the first run.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/payroll" className="text-sm font-medium text-primary hover:underline">
              Go to Payroll →
            </Link>
          </CardContent>
        </Card>
      )}
      {failures.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-warning">
              <AlertTriangle className="h-4 w-4" /> {failures.length} login{failures.length === 1 ? '' : 's'} not created
            </CardTitle>
            <CardDescription>
              These employees were imported during setup, but their login couldn’t be created.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <ul className="text-xs text-muted-foreground">
              {failures.slice(0, 5).map((f) => (
                <li key={f.email}>
                  {f.employeeCode} · {f.email} — {f.error}
                </li>
              ))}
              {failures.length > 5 && <li>…and {failures.length - 5} more</li>}
            </ul>
            <Button size="sm" variant="outline" className="self-start" disabled={retrying} onClick={() => void retry()}>
              <RefreshCw className="h-3.5 w-3.5" /> {retrying ? 'Retrying…' : 'Retry'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
