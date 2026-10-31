import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Cake,
  CalendarHeart,
  Check,
  CheckCircle2,
  Clock,
  PartyPopper,
  UserMinus,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { BarList, ChartTile, SegmentBar, Sparkline } from '@/components/charts';

interface PersonRef {
  id: string;
  name: string;
  designation: string | null;
  department: string | null;
}

export interface AdminInsights {
  asOf: string;
  activeHeadcount: number;
  status: {
    probation: number;
    confirmed: number;
    noticePeriod: number;
    suspended: number;
    preJoining: number;
    separated: number;
  };
  departments: { id: string; name: string; count: number }[];
  headcountTrend: { month: string; count: number }[];
  joinedLast30Days: number;
  joiningSoon: number;
  recentJoiners: (PersonRef & { dateOfJoining: string })[];
  upcomingBirthdays: (PersonRef & { date: string; daysUntil: number })[];
  upcomingAnniversaries: (PersonRef & { date: string; daysUntil: number; years: number })[];
  exiting: (PersonRef & { lastWorkingDate: string | null })[];
  needsAttention: { noDepartment: number; noJoiningDate: number };
  onLeaveToday: {
    total: number;
    /** Everyone on leave today, grouped by leave type. */
    byType: { name: string; count: number }[];
    people: { id: string; name: string; leaveType: string; halfDay: boolean; until: string }[];
  };
  attendanceToday: { present: number; late: number; onLeave: number; absent: number } | null;
  pendingRegularizations: number | null;
  pendingApprovals: {
    id: string;
    employee: { firstName: string; lastName: string };
    leaveType: { name: string };
    days: string;
    startDate: string;
    endDate: string;
  }[];
  /** Every request waiting on this user, grouped by leave type. */
  pendingByType: { name: string; requests: number; days: number }[];
  upcomingHolidays: { date: string; name: string; isOptional: boolean }[];
  latestPayroll: { period: string; status: string } | null;
}

export interface AdminDashboardData {
  view: 'admin';
  headcount: number;
  departmentBreakdown: { name: string; count: number }[];
  pendingApprovalsCount: number;
  /** Absent when the API is older than this screen — we fall back to the basic summary. */
  insights?: AdminInsights;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
const dayMonth = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
const inDays = (n: number) => (n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const PAYROLL_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  REVIEW: 'In review',
  APPROVED: 'Approved',
  PROCESSED: 'Processed',
  DISBURSED: 'Paid out',
};

export function AdminOverview({
  data,
  busyKey,
  onDecide,
}: {
  data: AdminDashboardData;
  busyKey: string | null;
  onDecide: (id: string, action: 'approve' | 'reject') => void;
}) {
  const i = data.insights;
  if (!i) return <BasicSummary data={data} />;

  const hasAttendance = i.attendanceToday !== null;
  const attentionRows =
    (i.pendingRegularizations ?? 0) > 0 || i.needsAttention.noDepartment > 0 || i.needsAttention.noJoiningDate > 0;
  const nextExit = i.exiting[0];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <ChartTile
          to="/dashboard/headcount"
          label="Headcount"
          value={String(i.activeHeadcount)}
          sub={i.joinedLast30Days > 0 ? `+${i.joinedLast30Days} in the last 30 days` : 'No new joiners this month'}
        >
          <Sparkline
            values={i.headcountTrend.map((t) => t.count)}
            ariaLabel="Working employees at the end of each of the last six months"
          />
        </ChartTile>
        {hasAttendance ? (
          <ChartTile
            to="/dashboard/present-today"
            label="Present today"
            value={String(i.attendanceToday!.present)}
            sub={`${i.attendanceToday!.late} late · ${i.attendanceToday!.onLeave} on leave`}
          >
            <SegmentBar
              height={8}
              ariaLabel={`Today: ${i.attendanceToday!.present - i.attendanceToday!.late} on time, ${i.attendanceToday!.late} late, ${i.attendanceToday!.onLeave} on leave, ${i.attendanceToday!.absent} absent`}
              segments={[
                { id: 'ontime', label: 'On time', value: i.attendanceToday!.present - i.attendanceToday!.late, tone: 1 },
                { id: 'late', label: 'Late', value: i.attendanceToday!.late, tone: 2 },
                { id: 'leave', label: 'On leave', value: i.attendanceToday!.onLeave, tone: 3 },
                { id: 'absent', label: 'Absent', value: i.attendanceToday!.absent, tone: 4 },
              ]}
            />
          </ChartTile>
        ) : (
          <Kpi
            icon={Clock}
            label="In probation"
            value={i.status.probation}
            sub={`${i.status.confirmed} confirmed`}
          />
        )}
        <ChartTile
          to="/dashboard/on-leave"
          label="On leave today"
          value={String(i.onLeaveToday.total)}
          sub="Approved leave"
        >
          {i.onLeaveToday.byType.length > 0 && (
            <BarList
              rows={i.onLeaveToday.byType.slice(0, 3).map((t) => ({ id: t.name, label: t.name, value: t.count }))}
              ariaLabel="People on leave today, by leave type"
              labelWidth="w-20"
            />
          )}
        </ChartTile>
        <ChartTile
          to="/dashboard/pending-approvals"
          label="Pending approvals"
          value={String(data.pendingApprovalsCount)}
          sub={data.pendingApprovalsCount > 0 ? 'Waiting on a decision' : 'All clear'}
          tone={data.pendingApprovalsCount > 0 ? 'warning' : undefined}
        >
          {i.pendingByType.length > 0 && (
            <BarList
              rows={i.pendingByType.slice(0, 3).map((t) => ({ id: t.name, label: t.name, value: t.days }))}
              ariaLabel="Leave days waiting for approval, by leave type"
              format={(n) => `${+n.toFixed(2)}d`}
              labelWidth="w-20"
            />
          )}
        </ChartTile>
        <Kpi
          icon={UserPlus}
          label="New joiners"
          value={i.joinedLast30Days}
          sub={i.joiningSoon > 0 ? `${i.joiningSoon} joining soon` : 'Last 30 days'}
        />
        <Kpi
          icon={UserMinus}
          label="On notice"
          value={i.status.noticePeriod}
          sub={
            nextExit
              ? `Next: ${nextExit.name}${nextExit.lastWorkingDate ? ` · ${dayMonth(nextExit.lastWorkingDate)}` : ''}`
              : 'No one leaving'
          }
          tone={i.status.noticePeriod > 0 ? 'warning' : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Needs your attention</CardTitle>
              <CardDescription>Decisions and clean-ups waiting for you.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {i.pendingApprovals.length === 0 && !attentionRows && (
                <EmptyState icon={CheckCircle2} title="You're all caught up" description="Nothing is waiting on you right now." className="py-6" />
              )}
              {i.pendingApprovals.map((r) => {
                const name = `${r.employee.firstName} ${r.employee.lastName}`.trim();
                return (
                  <div key={r.id} className="flex items-center gap-3 text-sm">
                    <Avatar name={name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.leaveType.name} · {dayMonth(r.startDate.slice(0, 10))}
                        {r.endDate.slice(0, 10) !== r.startDate.slice(0, 10) && ` – ${dayMonth(r.endDate.slice(0, 10))}`}
                      </p>
                    </div>
                    <Badge variant="warning">{r.days}d</Badge>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-destructive hover:text-destructive"
                        disabled={busyKey !== null}
                        aria-label={`Reject ${name}'s request`}
                        onClick={() => onDecide(r.id, 'reject')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 px-2"
                        disabled={busyKey !== null}
                        aria-label={`Approve ${name}'s request`}
                        onClick={() => onDecide(r.id, 'approve')}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
              {data.pendingApprovalsCount > i.pendingApprovals.length && (
                <Link to="/leave" className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline">
                  See all {data.pendingApprovalsCount} requests <ArrowUpRight className="h-3 w-3" />
                </Link>
              )}
              {attentionRows && (
                <div className={i.pendingApprovals.length > 0 ? 'flex flex-col gap-1 border-t border-border pt-3' : 'flex flex-col gap-1'}>
                  {(i.pendingRegularizations ?? 0) > 0 && (
                    <AttentionLink to="/attendance" text={`${plural(i.pendingRegularizations!, 'attendance regularization')} to review`} />
                  )}
                  {i.needsAttention.noDepartment > 0 && (
                    <AttentionLink to="/employees" text={`${plural(i.needsAttention.noDepartment, 'employee')} without a department`} />
                  )}
                  {i.needsAttention.noJoiningDate > 0 && (
                    <AttentionLink to="/employees" text={`${plural(i.needsAttention.noJoiningDate, 'employee')} without a joining date`} />
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Headcount trend</CardTitle>
              <CardDescription>{trendCaption(i.headcountTrend)}</CardDescription>
            </CardHeader>
            <CardContent>
              <TrendChart points={i.headcountTrend} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>Headcount by department</CardTitle>
                <CardDescription>Working employees, biggest teams first.</CardDescription>
              </div>
              <Link to="/departments" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline">
                Departments <ArrowUpRight className="h-3 w-3" />
              </Link>
            </CardHeader>
            <CardContent>
              {i.departments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No one is assigned to a department yet.</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {i.departments.slice(0, 8).map((d) => (
                    <BarRow key={d.id} label={d.name} count={d.count} total={i.activeHeadcount} />
                  ))}
                  {i.departments.length > 8 && (
                    <p className="text-xs text-muted-foreground">+ {i.departments.length - 8} more departments</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>On leave today</CardTitle>
              <CardDescription>
                {i.onLeaveToday.total === 0 ? 'Everyone is in.' : `${plural(i.onLeaveToday.total, 'person', 'people')} away.`}
              </CardDescription>
            </CardHeader>
            {i.onLeaveToday.total > 0 && (
              <CardContent className="flex flex-col gap-2.5">
                {i.onLeaveToday.people.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 text-sm">
                    <Avatar name={p.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.leaveType}
                        {p.halfDay && ' (half day)'} · until {dayMonth(p.until)}
                      </p>
                    </div>
                  </div>
                ))}
                {i.onLeaveToday.total > i.onLeaveToday.people.length && (
                  <p className="text-xs text-muted-foreground">+ {i.onLeaveToday.total - i.onLeaveToday.people.length} more</p>
                )}
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Coming up</CardTitle>
              <CardDescription>The next 30 days.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Upcoming title="Holidays" icon={PartyPopper} empty="No holidays scheduled.">
                {i.upcomingHolidays.slice(0, 3).map((h) => (
                  <UpcomingRow
                    key={h.date + h.name}
                    when={dayMonth(h.date)}
                    text={h.name}
                    sub={h.isOptional ? 'Optional' : undefined}
                  />
                ))}
              </Upcoming>
              <Upcoming title="Birthdays" icon={Cake} empty="No birthdays soon.">
                {i.upcomingBirthdays.slice(0, 4).map((p) => (
                  <UpcomingRow key={p.id} when={dayMonth(p.date)} text={p.name} sub={inDays(p.daysUntil)} />
                ))}
              </Upcoming>
              <Upcoming title="Work anniversaries" icon={CalendarHeart} empty="No anniversaries soon.">
                {i.upcomingAnniversaries.slice(0, 4).map((p) => (
                  <UpcomingRow
                    key={p.id}
                    when={dayMonth(p.date)}
                    text={p.name}
                    sub={`${plural(p.years, 'year')} · ${inDays(p.daysUntil).toLowerCase()}`}
                  />
                ))}
              </Upcoming>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Workforce</CardTitle>
              <CardDescription>By employment status.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              <BarRow label="Confirmed" count={i.status.confirmed} total={i.activeHeadcount} />
              <BarRow label="In probation" count={i.status.probation} total={i.activeHeadcount} />
              <BarRow label="On notice" count={i.status.noticePeriod} total={i.activeHeadcount} />
              {i.status.suspended > 0 && <BarRow label="Suspended" count={i.status.suspended} total={i.activeHeadcount} />}
              {i.status.preJoining > 0 && (
                <p className="border-t border-border pt-2 text-xs text-muted-foreground">
                  {plural(i.status.preJoining, 'person', 'people')} yet to join
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>New joiners</CardTitle>
              <CardDescription>Last 30 days.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              {i.recentJoiners.length === 0 && <p className="text-sm text-muted-foreground">No new joiners in the last 30 days.</p>}
              {i.recentJoiners.map((p) => (
                <div key={p.id} className="flex items-center gap-3 text-sm">
                  <Avatar name={p.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[p.designation, p.department].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{dayMonth(p.dateOfJoining)}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {i.latestPayroll && (
            <Link to="/payroll" className="block">
              <Card className="flex items-center justify-between gap-3 p-4 transition-shadow hover:shadow-md">
                <div className="flex items-center gap-3">
                  <Wallet className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Latest payroll run</p>
                    <p className="text-sm font-medium">{monthLabel(i.latestPayroll.period)} {i.latestPayroll.period.slice(0, 4)}</p>
                  </div>
                </div>
                <Badge variant={i.latestPayroll.status === 'DISBURSED' ? 'success' : 'outline'}>
                  {PAYROLL_LABEL[i.latestPayroll.status] ?? i.latestPayroll.status}
                </Badge>
              </Card>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function trendCaption(points: { month: string; count: number }[]) {
  if (points.length < 2) return 'Working employees at the end of each month.';
  const first = points[0];
  const last = points[points.length - 1];
  const diff = last.count - first.count;
  const change = diff === 0 ? 'no change' : `${diff > 0 ? '+' : ''}${diff}`;
  return `Working employees at month end · ${change} since ${monthLabel(first.month)}`;
}

function Kpi({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'warning';
}) {
  return (
    <div className="min-w-0">
      <Card className="flex h-full items-start justify-between gap-2 p-4">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === 'warning' ? 'text-warning' : ''}`}>{value}</p>
        {sub && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={sub}>
            {sub}
          </p>
        )}
      </div>
      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
      </Card>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
    >
      {initials(name)}
    </span>
  );
}

function AttentionLink({ to, text }: { to: string; text: string }) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"
    >
      <span>{text}</span>
      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
    </Link>
  );
}

/** One labelled bar: a thin single-colour fill on a neutral track, count beside it. */
function BarRow({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = (count / Math.max(1, total)) * 100;
  return (
    <div className="flex items-center gap-3">
      <span className="w-40 shrink-0 truncate text-sm" title={label}>
        {label}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-20 shrink-0 whitespace-nowrap text-right text-sm tabular-nums text-muted-foreground">
        {count} <span className="text-xs">({Math.round(pct)}%)</span>
      </span>
    </div>
  );
}

function Upcoming({
  title,
  icon: Icon,
  empty,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  empty: string;
  children: React.ReactNode;
}) {
  const rows = React.Children.toArray(children);
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {title}
      </p>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : <div className="flex flex-col gap-1.5">{rows}</div>}
    </div>
  );
}

function UpcomingRow({ when, text, sub }: { when: string; text: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-14 shrink-0 rounded-md bg-muted px-1.5 py-1 text-center text-xs font-medium tabular-nums">{when}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate">{text}</p>
        {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

/**
 * Month-end headcount as thin vertical bars from a zero baseline. One series in
 * one colour (the title names it), the newest month at full strength and the
 * rest softened; values are labelled and a screen-reader table mirrors them.
 */
function TrendChart({ points }: { points: { month: string; count: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.count));
  return (
    <figure>
      <div className="flex h-40 items-end gap-3 border-b border-border pb-px">
        {points.map((p, idx) => {
          const latest = idx === points.length - 1;
          return (
            <div
              key={p.month}
              className="group flex h-full flex-1 flex-col items-center justify-end gap-1"
              title={`${monthLabel(p.month)} ${p.month.slice(0, 4)}: ${p.count}`}
            >
              <span className={`text-xs tabular-nums ${latest ? 'font-semibold' : 'text-muted-foreground'}`}>{p.count}</span>
              <div
                className="w-full max-w-10 rounded-t-[4px] bg-primary transition-opacity group-hover:opacity-100"
                style={{ height: `${Math.max(2, (p.count / max) * 100)}%`, opacity: latest ? 1 : 0.45 }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-3">
        {points.map((p) => (
          <span key={p.month} className="flex-1 text-center text-xs text-muted-foreground">
            {monthLabel(p.month)}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Headcount at the end of each month</caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>Headcount</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.month}>
              <td>{p.month}</td>
              <td>{p.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** The original three-tile summary — shown only if the API doesn't send `insights` yet. */
function BasicSummary({ data }: { data: AdminDashboardData }) {
  return (
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
              <BarRow key={d.name} label={d.name} count={d.count} total={data.headcount} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
