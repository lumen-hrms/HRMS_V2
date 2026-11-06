import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/context/auth-context';
import {
  BarList,
  ChartLegend,
  ColumnChart,
  LineChart,
  TONE_COLOR,
  formatClock,
  formatMinutes,
  type ColumnBar,
  type LinePoint,
} from '@/components/charts';
import { currentMonth, dayLabel, dayOfMonth, monthDays, monthTitle } from './dates';
import { DataTable, MetricPage, MonthFilter } from './shell';
import { useFetch } from './use-fetch';

interface DailyAttendance {
  date: string;
  status: string;
  checkInMinutes: number | null;
  checkOutMinutes: number | null;
  workedMinutes: number | null;
  breakMinutes: number;
}

interface MonthStats {
  daysPresent: number;
  workingDays: number;
  punctualityRate: number;
  overtimeHours: number;
  targetHours: number;
  daily: DailyAttendance[];
}

const STATUS_LABEL: Record<string, string> = {
  PRESENT: 'Present',
  LATE: 'Late',
  ABSENT: 'Absent',
  ON_LEAVE: 'On leave',
  HOLIDAY: 'Holiday',
  WEEKLY_OFF: 'Weekly off',
  HALF_DAY: 'Half day',
};
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s.replace(/_/g, ' ').toLowerCase();

function statusBadge(s: string) {
  const variant = s === 'PRESENT' ? 'success' : s === 'LATE' ? 'warning' : s === 'ABSENT' ? 'destructive' : 'outline';
  return <Badge variant={variant}>{statusLabel(s)}</Badge>;
}

/** The month being viewed and its stats; the previous month's data stays on screen while the next loads. */
function useMonthStats() {
  const [month, setMonth] = React.useState(currentMonth);
  const res = useFetch<MonthStats>(`/attendance/stats?month=${month}`);
  return { month, setMonth, ...res };
}

const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

/** Days present, as hours worked per day against the shift target. */
export function AttendanceDetail() {
  const { month, setMonth, data, loading, error } = useMonthStats();
  const byDate = new Map((data?.daily ?? []).map((d) => [d.date, d]));
  const bars: ColumnBar[] = monthDays(month).map((date) => {
    const d = byDate.get(date);
    return {
      id: date,
      label: dayLabel(date),
      axisLabel: dayOfMonth(date),
      value: d?.workedMinutes != null ? hours(d.workedMinutes) : null,
      detail: d ? statusLabel(d.status) : undefined,
    };
  });

  return (
    <MetricPage
      title="Attendance"
      subtitle={data ? `${data.daysPresent} of ${data.workingDays} working days present in ${monthTitle(month)}` : undefined}
      filters={<MonthFilter month={month} onChange={setMonth} />}
      chartTitle="Hours worked each day"
      chartDescription="Time at work, net of breaks. The line is your shift's full-day target."
      chart={
        <ColumnChart
          bars={bars}
          seriesName="Worked"
          ariaLabel={`Hours worked each day in ${monthTitle(month)}`}
          yFormat={(n) => `${n}h`}
          valueFormat={(h) => formatMinutes(h * 60)}
          target={data ? { value: data.targetHours, label: `Target ${data.targetHours}h` } : undefined}
        />
      }
      detailTitle="Day by day"
      detailDescription={`Every day recorded in ${monthTitle(month)}.`}
      detail={
        <DataTable
          caption={`Attendance in ${monthTitle(month)}`}
          rows={data?.daily ?? []}
          rowKey={(d) => d.date}
          empty="No attendance recorded this month."
          columns={[
            { key: 'date', header: 'Date', render: (d) => dayLabel(d.date) },
            { key: 'status', header: 'Status', render: (d) => statusBadge(d.status) },
            { key: 'in', header: 'Check-in', render: (d) => (d.checkInMinutes === null ? '—' : formatClock(d.checkInMinutes)) },
            { key: 'out', header: 'Check-out', render: (d) => (d.checkOutMinutes === null ? '—' : formatClock(d.checkOutMinutes)) },
            { key: 'break', header: 'Breaks', align: 'right', render: (d) => (d.breakMinutes ? formatMinutes(d.breakMinutes) : '—') },
            { key: 'worked', header: 'Worked', align: 'right', render: (d) => (d.workedMinutes === null ? '—' : formatMinutes(d.workedMinutes)) },
          ]}
        />
      }
      ready={!!data}
      loading={loading}
      error={error}
    />
  );
}

/** Punctuality: when you clocked in each day, with late days marked. */
export function PunctualityDetail() {
  const { month, setMonth, data, loading, error } = useMonthStats();
  const byDate = new Map((data?.daily ?? []).map((d) => [d.date, d]));
  const points: LinePoint[] = monthDays(month).map((date) => {
    const d = byDate.get(date);
    const late = d?.status === 'LATE';
    return {
      id: date,
      label: dayLabel(date),
      axisLabel: dayOfMonth(date),
      value: d?.checkInMinutes ?? null,
      tone: late ? 2 : 1,
      detail: late ? 'Late' : 'On time',
    };
  });

  const checkIns = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  const lateCount = (data?.daily ?? []).filter((d) => d.status === 'LATE' && d.checkInMinutes !== null).length;
  const onTimeCount = checkIns.length - lateCount;

  // A time-of-day axis hugging the data, on half-hour (or hour) gridlines.
  const lo = checkIns.length ? Math.floor((Math.min(...checkIns) - 30) / 30) * 30 : 8 * 60;
  const hi = checkIns.length ? Math.max(Math.ceil((Math.max(...checkIns) + 30) / 30) * 30, lo + 60) : 11 * 60;
  const gap = hi - lo > 180 ? 60 : 30;
  const ticks = Array.from({ length: Math.floor((hi - lo) / gap) + 1 }, (_, i) => lo + i * gap);

  return (
    <MetricPage
      title="Punctuality"
      subtitle={data ? `${data.punctualityRate}% of present days on time in ${monthTitle(month)}` : undefined}
      filters={<MonthFilter month={month} onChange={setMonth} />}
      chartTitle="Check-in time each day"
      chartDescription="Each dot is when you clocked in — higher up the chart means later."
      chart={
        checkIns.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No check-ins recorded this month.</p>
        ) : (
          <LineChart
            points={points}
            seriesName="Check-in"
            ariaLabel={`Check-in time each day in ${monthTitle(month)}`}
            markersCarryTone
            domain={{ min: lo, max: hi, ticks }}
            yFormat={formatClock}
            valueFormat={formatClock}
          />
        )
      }
      legend={
        <ChartLegend
          items={[
            { color: TONE_COLOR[1], label: 'On time', value: String(onTimeCount) },
            { color: TONE_COLOR[2], label: 'Late', value: String(lateCount) },
          ]}
        />
      }
      detailTitle="Check-ins"
      detailDescription={`Every check-in in ${monthTitle(month)}.`}
      detail={
        <DataTable
          caption={`Check-in times in ${monthTitle(month)}`}
          rows={(data?.daily ?? []).filter((d) => d.checkInMinutes !== null)}
          rowKey={(d) => d.date}
          empty="No check-ins recorded this month."
          columns={[
            { key: 'date', header: 'Date', render: (d) => dayLabel(d.date) },
            { key: 'in', header: 'Check-in', render: (d) => formatClock(d.checkInMinutes!) },
            {
              key: 'status',
              header: 'On time?',
              render: (d) => <Badge variant={d.status === 'LATE' ? 'warning' : 'success'}>{d.status === 'LATE' ? 'Late' : 'On time'}</Badge>,
            },
          ]}
        />
      }
      ready={!!data}
      loading={loading}
      error={error}
    />
  );
}

/** Overtime: hours beyond the shift target, on the days they happened. */
export function OvertimeDetail() {
  const { month, setMonth, data, loading, error } = useMonthStats();
  const target = data?.targetHours ?? 0;
  const complete = (data?.daily ?? []).filter((d) => d.workedMinutes !== null);
  const overtimeOf = (d: DailyAttendance) => Math.max(d.workedMinutes! - target * 60, 0);
  const byDate = new Map(complete.map((d) => [d.date, d]));

  const bars: ColumnBar[] = monthDays(month).map((date) => {
    const d = byDate.get(date);
    return {
      id: date,
      label: dayLabel(date),
      axisLabel: dayOfMonth(date),
      value: d ? hours(overtimeOf(d)) : null,
      detail: d ? `Worked ${formatMinutes(d.workedMinutes!)}` : undefined,
    };
  });

  return (
    <MetricPage
      title="Overtime"
      subtitle={data ? `${data.overtimeHours}h beyond your ${target}h shift in ${monthTitle(month)}` : undefined}
      filters={<MonthFilter month={month} onChange={setMonth} />}
      chartTitle="Overtime each day"
      chartDescription="Hours worked beyond the shift's full-day target."
      chart={
        <ColumnChart
          bars={bars}
          seriesName="Overtime"
          ariaLabel={`Overtime hours each day in ${monthTitle(month)}`}
          yFormat={(n) => `${n}h`}
          valueFormat={(h) => formatMinutes(h * 60)}
        />
      }
      detailTitle="Days worked"
      detailDescription={`Completed days in ${monthTitle(month)}, with the overtime on each.`}
      detail={
        <DataTable
          caption={`Overtime in ${monthTitle(month)}`}
          rows={complete}
          rowKey={(d) => d.date}
          empty="No completed days this month."
          columns={[
            { key: 'date', header: 'Date', render: (d) => dayLabel(d.date) },
            { key: 'worked', header: 'Worked', align: 'right', render: (d) => formatMinutes(d.workedMinutes!) },
            { key: 'target', header: 'Target', align: 'right', render: () => `${target}h` },
            {
              key: 'ot',
              header: 'Overtime',
              align: 'right',
              render: (d) => (overtimeOf(d) > 0 ? <strong>{formatMinutes(overtimeOf(d))}</strong> : '—'),
            },
          ]}
        />
      }
      ready={!!data}
      loading={loading}
      error={error}
    />
  );
}

interface LeaveBalance {
  id: string;
  accrued: number | string;
  carriedForward?: number | string;
  used: number | string;
  pending?: number | string;
  leaveType: { code?: string; name: string };
}

/** Leave balances: days still available per leave type. */
export function LeaveBalanceDetail() {
  const { user } = useAuth();
  const { data, loading, error } = useFetch<LeaveBalance[]>(
    user?.employeeId ? `/leave/balances/${user.employeeId}` : null,
  );
  const rows = (data ?? [])
    .map((b) => {
      const accrued = Number(b.accrued);
      const carried = Number(b.carriedForward ?? 0);
      const used = Number(b.used);
      const pending = Number(b.pending ?? 0);
      return { id: b.id, name: b.leaveType.name, accrued, carried, used, pending, available: accrued + carried - used - pending };
    })
    .sort((a, b) => b.available - a.available || a.name.localeCompare(b.name));
  const total = rows.reduce((sum, r) => sum + r.available, 0);
  const days = (n: number) => `${+n.toFixed(2)}`;

  return (
    <MetricPage
      title="Leave balances"
      subtitle={data ? `${days(total)} days available across ${rows.length} leave ${rows.length === 1 ? 'type' : 'types'}` : undefined}
      chartTitle="Days available by leave type"
      chartDescription="Accrued and carried-forward days, less what you've used or have pending."
      chart={
        rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No leave has been allocated to you yet.</p>
        ) : (
          <BarList
            rows={rows.map((r) => ({ id: r.id, label: r.name, value: Math.max(r.available, 0) }))}
            ariaLabel="Days available by leave type"
            format={(n) => `${days(n)}d`}
            labelWidth="w-40"
          />
        )
      }
      detailTitle="Balance breakdown"
      detailDescription="How each available figure is made up."
      detail={
        <DataTable
          caption="Leave balance breakdown"
          rows={rows}
          rowKey={(r) => r.id}
          empty="No leave has been allocated to you yet."
          columns={[
            { key: 'type', header: 'Leave type', render: (r) => r.name },
            { key: 'accrued', header: 'Accrued', align: 'right', render: (r) => days(r.accrued) },
            { key: 'carried', header: 'Carried forward', align: 'right', render: (r) => days(r.carried) },
            { key: 'used', header: 'Used', align: 'right', render: (r) => days(r.used) },
            { key: 'pending', header: 'Pending', align: 'right', render: (r) => days(r.pending) },
            { key: 'available', header: 'Available', align: 'right', render: (r) => <strong>{days(r.available)}</strong> },
          ]}
        />
      }
      ready={!!data || !user?.employeeId}
      loading={loading}
      error={error}
    />
  );
}
