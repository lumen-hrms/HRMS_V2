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

const APPROVER_ROLES = ['LINE_MANAGER', 'HR_MANAGER', 'COMPANY_ADMIN'];

interface TodayAttendanceSnapshot {
  status: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  isOnBreak: boolean;
  effectiveMs: number;
  targetHours: number;
}

interface AdminDashboard {
  view: 'admin';
  headcount: number;
  departmentBreakdown: { name: string; count: number }[];
  pendingApprovalsCount: number;
  todayAttendance: TodayAttendanceSnapshot | null;
}

interface EmployeeDashboard {
  view: 'employee';
  leaveBalances: {
    id: string;
    accrued: string;
    used: string;
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
}

type DashboardData = AdminDashboard | EmployeeDashboard;

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
        <h1 className="text-xl font-semibold">Welcome back{user ? `, ${user.email}` : ''}</h1>
        <p className="text-sm text-muted-foreground">Here's what's happening across your organization.</p>
      </div>

      {data.todayAttendance && (
        <TodayAttendanceCard
          snapshot={data.todayAttendance}
          busy={busy === 'attendance'}
          onAction={(path) => runAction('attendance', () => api.post(path))}
        />
      )}

      {data.view === 'admin' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardDescription>Total headcount</CardDescription>
              <CardTitle className="text-3xl">{data.headcount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Pending approvals</CardDescription>
              <CardTitle className="text-3xl">{data.pendingApprovalsCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card className="sm:col-span-2 lg:col-span-1">
            <CardHeader>
              <CardDescription>Departments</CardDescription>
              <CardTitle className="text-3xl">{data.departmentBreakdown.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card className="sm:col-span-2 lg:col-span-3">
            <CardHeader>
              <CardTitle>Headcount by department</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                {data.departmentBreakdown.map((d) => {
                  const pct = (d.count / Math.max(1, data.headcount)) * 100;
                  return (
                    <div key={d.name} className="flex items-center gap-3">
                      <span className="w-32 shrink-0 truncate text-sm">{d.name}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-24 shrink-0 text-right text-sm text-muted-foreground">
                        {d.count} ({pct.toFixed(1)}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>My leave balances</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {data.leaveBalances.length === 0 && (
                <EmptyState icon={Wallet} title="No balances allocated yet" className="py-6" />
              )}
              {data.leaveBalances.map((b) => (
                <div key={b.id} className="flex items-center justify-between text-sm">
                  <span>{b.leaveType.name}</span>
                  <span className="font-medium">
                    {Number(b.accrued) - Number(b.used)} / {b.accrued} days left
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

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

function formatHm(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

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
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardDescription>Today's attendance</CardDescription>
          <CardTitle className="text-lg">{formatHm(snapshot.effectiveMs)} worked</CardTitle>
        </div>
        <div className="flex items-center gap-2">
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
                onClick={() => onAction('/attendance/clock-out')}
              >
                <LogOut className="h-4 w-4" /> Clock out
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex gap-6 text-sm text-muted-foreground">
        <span>
          Check-in:{' '}
          {snapshot.checkInAt ? new Date(snapshot.checkInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
        </span>
        <span>
          Check-out:{' '}
          {snapshot.checkOutAt ? new Date(snapshot.checkOutAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
        </span>
        <span>Target: {snapshot.targetHours}h</span>
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
