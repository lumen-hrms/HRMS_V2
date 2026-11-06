import { Link } from 'react-router-dom';
import { CalendarDays, PartyPopper, Plane, UserPlus, Users, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { BarList, ChartTile, MiniColumns, SegmentBar } from '@/components/charts';

type TeamMemberRelation = 'BOSS' | 'TEAMMATE' | 'REPORT';

interface PersonRef {
  id: string;
  name: string;
  designation: string | null;
}

export interface EmployeeInsights {
  /** Null when the plan has no Attendance module. */
  monthAttendance: {
    daysPresent: number;
    workingDays: number;
    punctualityRate: number;
    overtimeHours: number;
    targetHours: number;
    /** The month so far, one entry per recorded day. */
    daily: { date: string; status: string; workedMinutes: number | null }[];
  } | null;
  upcomingHolidays: { id: string; name: string; date: string; isOptional: boolean; daysUntil: number }[];
  /** Null when the login isn't linked to an employee record. */
  myTeam: {
    manager: PersonRef | null;
    teammateCount: number;
    reportCount: number;
  } | null;
  teamOnLeave: {
    id: string;
    name: string;
    relation: TeamMemberRelation;
    from: string;
    to: string;
    halfDay: boolean;
    onLeaveToday: boolean;
  }[];
  celebrations: {
    newJoiners: (PersonRef & { date: string })[];
    anniversaries: (PersonRef & { date: string; daysUntil: number; years: number })[];
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMonth = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};
const inDays = (n: number) => (n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dateRange = (from: string, to: string) =>
  from === to ? dayMonth(from) : `${dayMonth(from)} – ${dayMonth(to)}`;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

const RELATION_LABEL: Record<TeamMemberRelation, string> = {
  BOSS: 'Your manager',
  TEAMMATE: 'Teammate',
  REPORT: 'Reports to you',
};

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
      {initials(name)}
    </span>
  );
}

interface LeaveBalanceRow {
  id: string;
  accrued: number | string;
  carriedForward?: number | string;
  used: number | string;
  pending?: number | string;
  leaveType: { name: string };
}

/** Days available per leave type — the same figure the Leave page shows. */
function availableDays(b: LeaveBalanceRow): number {
  return Number(b.accrued) + Number(b.carriedForward ?? 0) - Number(b.used) - Number(b.pending ?? 0);
}

/** "My leave balances" as bars per leave type, opening the full breakdown. */
export function LeaveBalanceTile({ balances }: { balances: LeaveBalanceRow[] }) {
  if (balances.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My leave balances</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState icon={Wallet} title="No balances allocated yet" className="py-6" />
        </CardContent>
      </Card>
    );
  }
  const rows = balances
    .map((b) => ({ id: b.id, label: b.leaveType.name, value: Math.max(availableDays(b), 0) }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const shown = rows.slice(0, 4);
  return (
    <ChartTile
      to="/dashboard/leave-balance"
      label="My leave balances"
      value={`${+total.toFixed(2)} days`}
      sub={`Available across ${rows.length} leave ${rows.length === 1 ? 'type' : 'types'}`}
    >
      <BarList
        rows={shown}
        ariaLabel="Days available by leave type"
        format={(n) => `${+n.toFixed(2)}d`}
        labelWidth="w-28"
      />
      {rows.length > shown.length && (
        <p className="mt-2 text-xs text-muted-foreground">+ {rows.length - shown.length} more</p>
      )}
    </ChartTile>
  );
}

/**
 * The employee dashboard's extra panels: this month at a glance, what's
 * coming up, and the people around you. `canViewTeam` links the team card to
 * the directory's *My team* filter (Employees only — it is their directory).
 */
export function EmployeeInsightsPanels({
  insights,
  canViewTeam,
}: {
  insights: EmployeeInsights;
  canViewTeam: boolean;
}) {
  const { monthAttendance: m, upcomingHolidays, myTeam, teamOnLeave, celebrations } = insights;
  const onTime = m?.daily.filter((d) => d.status === 'PRESENT').length ?? 0;
  const late = m?.daily.filter((d) => d.status === 'LATE').length ?? 0;
  const awayToday = teamOnLeave.filter((l) => l.onLeaveToday);
  const awayLater = teamOnLeave.filter((l) => !l.onLeaveToday);

  return (
    <div className="flex flex-col gap-4">
      {m && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ChartTile
            to="/dashboard/attendance"
            label="Days present this month"
            value={`${m.daysPresent} / ${m.workingDays}`}
            sub="Working days so far"
          >
            <MiniColumns
              values={m.daily.map((d) => d.workedMinutes)}
              ariaLabel="Hours worked each day this month"
            />
          </ChartTile>
          <ChartTile
            to="/dashboard/punctuality"
            label="Punctuality"
            value={`${m.punctualityRate}%`}
            sub="Days you clocked in on time"
          >
            {onTime + late > 0 && (
              <SegmentBar
                height={8}
                ariaLabel={`${onTime} days on time, ${late} late`}
                segments={[
                  { id: 'ontime', label: 'On time', value: onTime, tone: 1 },
                  { id: 'late', label: 'Late', value: late, tone: 2 },
                ]}
              />
            )}
          </ChartTile>
          <ChartTile
            to="/dashboard/overtime"
            label="Overtime this month"
            value={`${m.overtimeHours}h`}
            sub={`Beyond your ${m.targetHours}h shift`}
          >
            <MiniColumns
              values={m.daily.map((d) => (d.workedMinutes === null ? null : Math.max(d.workedMinutes - m.targetHours * 60, 0)))}
              ariaLabel="Overtime hours each day this month"
            />
          </ChartTile>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4" /> Upcoming holidays
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {upcomingHolidays.length === 0 && (
              <EmptyState icon={CalendarDays} title="No upcoming holidays" className="py-6" />
            )}
            {upcomingHolidays.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">
                  {h.name}
                  {h.isOptional && <span className="ml-2 text-xs text-muted-foreground">(optional)</span>}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {dayMonth(h.date)} · {inDays(h.daysUntil)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" /> My team
            </CardTitle>
            <CardDescription>The people you work with most.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {!myTeam && (
              <EmptyState icon={Users} title="Your login isn't linked to an employee record" className="py-6" />
            )}
            {myTeam && (
              <>
                <div className="flex items-center gap-3">
                  {myTeam.manager ? (
                    <>
                      <Avatar name={myTeam.manager.name} />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{myTeam.manager.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          Your manager{myTeam.manager.designation ? ` · ${myTeam.manager.designation}` : ''}
                        </p>
                      </div>
                    </>
                  ) : (
                    <p className="text-muted-foreground">You don’t have a reporting manager set.</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{plural(myTeam.teammateCount, 'teammate')}</Badge>
                  <Badge variant="outline">{plural(myTeam.reportCount, 'person', 'people')} reporting to you</Badge>
                </div>
                {canViewTeam && (
                  <Link to="/employees?team=1" className="text-sm font-medium text-primary hover:underline">
                    View my team →
                  </Link>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {myTeam && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Plane className="h-4 w-4" /> Team on leave
              </CardTitle>
              <CardDescription>Your manager, teammates and reports — today and the next 7 days.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {teamOnLeave.length === 0 && (
                <EmptyState icon={Plane} title="Everyone on your team is in" className="py-6" />
              )}
              {[...awayToday, ...awayLater].map((l) => (
                <div key={`${l.id}-${l.from}`} className="flex items-center gap-3 text-sm">
                  <Avatar name={l.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{l.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{RELATION_LABEL[l.relation]}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-muted-foreground">
                      {dateRange(l.from, l.to)}
                      {l.halfDay ? ' · half day' : ''}
                    </p>
                    {l.onLeaveToday && <Badge variant="warning">On leave today</Badge>}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PartyPopper className="h-4 w-4" /> Joiners &amp; anniversaries
            </CardTitle>
            <CardDescription>Across the company, in the last and next 30 days.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {celebrations.newJoiners.length === 0 && celebrations.anniversaries.length === 0 && (
              <EmptyState icon={PartyPopper} title="Nothing to celebrate just yet" className="py-6" />
            )}
            {celebrations.newJoiners.map((j) => (
              <div key={`join-${j.id}`} className="flex items-center gap-3 text-sm">
                <UserPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{j.name}</span>
                  {j.designation ? ` · ${j.designation}` : ''}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">Joined {dayMonth(j.date)}</span>
              </div>
            ))}
            {celebrations.anniversaries.map((a) => (
              <div key={`anniv-${a.id}`} className="flex items-center gap-3 text-sm">
                <PartyPopper className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{a.name}</span> · {plural(a.years, 'year')}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {dayMonth(a.date)} · {inDays(a.daysUntil)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
