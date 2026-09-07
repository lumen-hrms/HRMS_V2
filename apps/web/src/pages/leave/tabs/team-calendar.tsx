import * as React from 'react';
import { Users } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { LeaveMonthCalendar } from '@/pages/leave/components/leave-month-calendar';
import { LeaveStatusBadge, LeaveTypeChip, fmtRange } from '@/pages/leave/shared';
import { leaveApi } from '@/lib/leave/client';
import type { Holiday, TeamCalendarEntry } from '@/lib/leave/types';
import { useLeaveCtx } from '@/pages/leave/use-leave-ctx';

/**
 * Who on the team is off, and when. Full-width month grid (holidays +
 * weekly-offs + one chip per person per leave day) with a side list of the
 * month's entries. Scope follows the caller's role: Line Manager → direct
 * reports; HR / Company Admin → everyone.
 */
export function TeamCalendarTab() {
  const ctx = useLeaveCtx();
  const [month, setMonth] = React.useState(new Date());
  const [entries, setEntries] = React.useState<TeamCalendarEntry[]>([]);
  const [holidays, setHolidays] = React.useState<Holiday[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!ctx) return;
    const y = month.getFullYear();
    const mm = String(month.getMonth() + 1).padStart(2, '0');
    const from = `${y}-${mm}-01`;
    const to = `${y}-${mm}-31`;
    setLoading(true);
    Promise.all([leaveApi.teamCalendar(ctx, from, to), leaveApi.listHolidays(y)])
      .then(([e, h]) => {
        setEntries(e);
        setHolidays(h);
      })
      .finally(() => setLoading(false));
  }, [ctx, month]);

  if (!ctx) {
    return <p className="text-sm text-muted-foreground">This account has no linked employee record.</p>;
  }

  const sorted = [...entries].sort((a, b) => a.startDate.localeCompare(b.startDate));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      <LeaveMonthCalendar
        month={month}
        onMonthChange={setMonth}
        holidays={holidays}
        entries={entries}
      />

      <Card className="flex flex-col p-4">
        <h3 className="mb-3 text-sm font-semibold">
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} · away
        </h3>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : sorted.length === 0 ? (
          <EmptyState icon={Users} title="Nobody's off this month" />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {sorted.map((e) => (
              <li key={e.requestId} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{e.employeeName}</div>
                  <div className="text-xs text-muted-foreground">
                    {fmtRange(e.startDate, e.endDate)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <LeaveTypeChip code={e.leaveTypeCode} colorToken={e.colorToken} />
                  <LeaveStatusBadge status={e.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
