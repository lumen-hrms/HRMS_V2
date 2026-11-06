import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { BarList, LineChart, SegmentBar, type LinePoint } from '@/components/charts';
import type { AdminDashboardData } from '@/pages/dashboard-admin';
import { monthShort, monthTitle, shortDate, timeOf } from './dates';
import { DataTable, MetricPage } from './shell';
import { useFetch } from './use-fetch';

/** The admin dashboard payload; its `insights` block feeds every chart here. */
function useInsights() {
  const res = useFetch<AdminDashboardData>('/dashboard');
  return { ...res, insights: res.data?.insights ?? null };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const DetailLink = ({ to, children }: { to: string; children: string }) => (
  <Link to={to} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
    {children} <ArrowUpRight className="h-3.5 w-3.5" />
  </Link>
);

/** Headcount: month-end working employees over the last six months, and who they are by department. */
export function HeadcountDetail() {
  const { insights, loading, error } = useInsights();
  const trend = insights?.headcountTrend ?? [];
  const points: LinePoint[] = trend.map((t) => ({
    id: t.month,
    label: monthTitle(t.month),
    axisLabel: monthShort(t.month),
    value: t.count,
  }));
  const total = insights?.activeHeadcount ?? 0;
  const change = trend.length > 1 ? trend[trend.length - 1].count - trend[0].count : 0;

  return (
    <MetricPage
      title="Headcount"
      subtitle={
        insights
          ? `${plural(total, 'working employee')}${trend.length > 1 ? ` · ${change === 0 ? 'no change' : `${change > 0 ? '+' : ''}${change}`} since ${monthTitle(trend[0].month)}` : ''}`
          : undefined
      }
      chartTitle="Working employees at each month end"
      chartDescription="The last six months; this month is up to today."
      chart={
        <LineChart
          points={points}
          seriesName="Headcount"
          ariaLabel="Working employees at the end of each of the last six months"
        />
      }
      detailTitle="Headcount by department"
      detailDescription="Working employees, biggest teams first."
      detail={
        <div className="flex flex-col gap-4">
          <DataTable
            caption="Headcount by department"
            rows={insights?.departments ?? []}
            rowKey={(d) => d.id}
            empty="No one is assigned to a department yet."
            columns={[
              { key: 'name', header: 'Department', render: (d) => d.name },
              { key: 'count', header: 'Employees', align: 'right', render: (d) => d.count },
              {
                key: 'share',
                header: 'Share',
                align: 'right',
                render: (d) => `${total ? Math.round((d.count / total) * 100) : 0}%`,
              },
            ]}
          />
          <DetailLink to="/employees">Open the employee directory</DetailLink>
        </div>
      }
      ready={!!insights}
      loading={loading}
      error={error}
    />
  );
}

interface RosterRow {
  employeeId: string;
  employeeName: string;
  department: string | null;
  record: { status: string; checkInAt: string | null; checkOutAt: string | null } | null;
}

const STATUS_ORDER = ['LATE', 'PRESENT', 'ON_LEAVE', 'ABSENT'];
const rank = (r: RosterRow) => {
  const i = r.record ? STATUS_ORDER.indexOf(r.record.status) : -1;
  return i === -1 ? STATUS_ORDER.length : i;
};

/** Present today: how today splits, and where each person stands. */
export function PresentTodayDetail() {
  const { insights, loading, error } = useInsights();
  const roster = useFetch<RosterRow[]>('/attendance/team/roster');
  const a = insights?.attendanceToday ?? null;
  const rows = [...(roster.data ?? [])].sort(
    (x, y) => rank(x) - rank(y) || x.employeeName.localeCompare(y.employeeName),
  );
  const badge = (r: RosterRow) => {
    const s = r.record?.status;
    if (!s) return <Badge variant="outline">Not marked</Badge>;
    const variant = s === 'PRESENT' ? 'success' : s === 'LATE' ? 'warning' : s === 'ABSENT' ? 'destructive' : 'outline';
    return <Badge variant={variant}>{s === 'ON_LEAVE' ? 'On leave' : s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ')}</Badge>;
  };

  return (
    <MetricPage
      title="Present today"
      subtitle={a ? `${plural(a.present, 'person', 'people')} in, ${a.late} of them late` : undefined}
      chartTitle="Today's attendance"
      chartDescription="Everyone with an attendance record for today."
      chart={
        a && (
          <SegmentBar
            height={20}
            ariaLabel={`Today: ${a.present - a.late} on time, ${a.late} late, ${a.onLeave} on leave, ${a.absent} absent`}
            segments={[
              { id: 'ontime', label: 'On time', value: a.present - a.late, tone: 1 },
              { id: 'late', label: 'Late', value: a.late, tone: 2 },
              { id: 'leave', label: 'On leave', value: a.onLeave, tone: 3 },
              { id: 'absent', label: 'Absent', value: a.absent, tone: 4 },
            ]}
          />
        )
      }
      detailTitle="Who's in"
      detailDescription="Late first, then present, on leave and absent."
      detail={
        <div className="flex flex-col gap-4">
          <DataTable
            caption="Attendance status of each employee today"
            rows={rows}
            rowKey={(r) => r.employeeId}
            empty={roster.loading ? 'Loading…' : 'No employees to show.'}
            columns={[
              { key: 'name', header: 'Employee', render: (r) => r.employeeName },
              { key: 'dept', header: 'Department', render: (r) => r.department ?? '—' },
              { key: 'status', header: 'Status', render: badge },
              { key: 'in', header: 'Check-in', render: (r) => timeOf(r.record?.checkInAt) },
              { key: 'out', header: 'Check-out', render: (r) => timeOf(r.record?.checkOutAt) },
            ]}
          />
          <DetailLink to="/attendance">Open attendance</DetailLink>
        </div>
      }
      ready={!!a}
      loading={loading || roster.loading}
      error={error ?? roster.error}
    />
  );
}

interface OnLeaveRow {
  id: string;
  name: string;
  department: string | null;
  leaveType: string;
  halfDay: boolean;
  from: string;
  until: string;
  days: number;
}

/** On leave today: how many are away for each kind of leave, and who. */
export function OnLeaveDetail() {
  const { insights, loading, error } = useInsights();
  const people = useFetch<OnLeaveRow[]>('/dashboard/on-leave');
  const total = insights?.onLeaveToday.total ?? 0;
  const byType = insights?.onLeaveToday.byType ?? [];

  return (
    <MetricPage
      title="On leave today"
      subtitle={insights ? (total === 0 ? 'Everyone is in.' : `${plural(total, 'person', 'people')} away`) : undefined}
      chartTitle="People away, by type of leave"
      chartDescription="Approved leave that covers today."
      chart={
        byType.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No one is on leave today.</p>
        ) : (
          <BarList
            rows={byType.map((t) => ({ id: t.name, label: t.name, value: t.count }))}
            ariaLabel="People on leave today, by leave type"
            labelWidth="w-40"
          />
        )
      }
      detailTitle="Who's away"
      detailDescription="Approved leave covering today."
      detail={
        <DataTable
          caption="Employees on leave today"
          rows={people.data ?? []}
          rowKey={(r) => r.id}
          empty={people.loading ? 'Loading…' : 'No one is on leave today.'}
          columns={[
            { key: 'name', header: 'Employee', render: (r) => r.name },
            { key: 'dept', header: 'Department', render: (r) => r.department ?? '—' },
            { key: 'type', header: 'Leave type', render: (r) => `${r.leaveType}${r.halfDay ? ' (half day)' : ''}` },
            { key: 'from', header: 'From', render: (r) => shortDate(r.from) },
            { key: 'until', header: 'Back after', render: (r) => shortDate(r.until) },
            { key: 'days', header: 'Days', align: 'right', render: (r) => r.days },
          ]}
        />
      }
      ready={!!insights}
      loading={loading || people.loading}
      error={error ?? people.error}
    />
  );
}

interface PendingRow {
  id: string;
  employee: { firstName: string; lastName: string };
  leaveType: { name: string };
  days: string | number;
  startDate: string;
  endDate: string;
}

/** Pending approvals: how much leave is waiting, by type, and each request. */
export function PendingApprovalsDetail() {
  const { insights, data, loading, error } = useInsights();
  const requests = useFetch<PendingRow[]>('/dashboard/pending-approvals');
  const count = data?.pendingApprovalsCount ?? 0;
  const byType = insights?.pendingByType ?? [];

  return (
    <MetricPage
      title="Pending approvals"
      subtitle={data ? (count === 0 ? 'All clear.' : `${plural(count, 'request')} waiting on your decision`) : undefined}
      chartTitle="Days waiting, by type of leave"
      chartDescription="Leave days across the requests waiting on you."
      chart={
        byType.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Nothing is waiting on you.</p>
        ) : (
          <BarList
            rows={byType.map((t) => ({
              id: t.name,
              label: t.name,
              value: t.days,
              sub: plural(t.requests, 'request'),
            }))}
            ariaLabel="Leave days waiting for approval, by leave type"
            format={(n) => `${+n.toFixed(2)}d`}
            labelWidth="w-40"
          />
        )
      }
      detailTitle="Requests"
      detailDescription="Oldest first. Open Leave to approve or reject."
      detail={
        <div className="flex flex-col gap-4">
          <DataTable
            caption="Leave requests waiting on you"
            rows={requests.data ?? []}
            rowKey={(r) => r.id}
            empty={requests.loading ? 'Loading…' : 'Nothing is waiting on you.'}
            columns={[
              { key: 'name', header: 'Employee', render: (r) => `${r.employee.firstName} ${r.employee.lastName}`.trim() },
              { key: 'type', header: 'Leave type', render: (r) => r.leaveType.name },
              {
                key: 'dates',
                header: 'Dates',
                render: (r) =>
                  r.startDate.slice(0, 10) === r.endDate.slice(0, 10)
                    ? shortDate(r.startDate)
                    : `${shortDate(r.startDate)} – ${shortDate(r.endDate)}`,
              },
              { key: 'days', header: 'Days', align: 'right', render: (r) => Number(r.days) },
            ]}
          />
          <DetailLink to="/leave">Review in Leave</DetailLink>
        </div>
      }
      ready={!!data}
      loading={loading || requests.loading}
      error={error ?? requests.error}
    />
  );
}
