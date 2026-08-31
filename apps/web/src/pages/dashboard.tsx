import * as React from 'react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/context/auth-context';

interface AdminDashboard {
  view: 'admin';
  headcount: number;
  departmentBreakdown: { name: string; count: number }[];
  pendingApprovalsCount: number;
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
}

type DashboardData = AdminDashboard | EmployeeDashboard;

export function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = React.useState<DashboardData | null>(null);

  React.useEffect(() => {
    api.get<DashboardData>('/dashboard').then(setData);
  }, []);

  if (!data) return <p className="text-muted-foreground">Loading dashboard…</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Welcome back{user ? `, ${user.email}` : ''}</h1>
        <p className="text-sm text-muted-foreground">Here's what's happening across your organization.</p>
      </div>

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
                {data.departmentBreakdown.map((d) => (
                  <div key={d.name} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 text-sm">{d.name}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${(d.count / Math.max(1, data.headcount)) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="w-8 text-right text-sm text-muted-foreground">{d.count}</span>
                  </div>
                ))}
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
                <p className="text-sm text-muted-foreground">No balances allocated yet.</p>
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
                <p className="text-sm text-muted-foreground">Nothing pending. 🎉</p>
              )}
              {data.pendingApprovals.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-sm">
                  <span>
                    {r.employee.firstName} {r.employee.lastName} · {r.leaveType.name}
                  </span>
                  <Badge variant="warning">{r.days}d</Badge>
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
                <p className="text-sm text-muted-foreground">You haven't applied for leave yet.</p>
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

export function StatusBadge({ status }: { status: string }) {
  const variant =
    status === 'APPROVED'
      ? 'success'
      : status === 'REJECTED' || status === 'CANCELLED'
        ? 'destructive'
        : 'warning';
  return <Badge variant={variant}>{status.replace('_', ' ')}</Badge>;
}
