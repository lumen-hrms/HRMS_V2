import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Holiday, TeamCalendarEntry } from '@/lib/leave/types';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Month grid showing company holidays, weekly-offs, and leave entries (one
 * chip per person per day). `highlight` paints a proposed date range — used on
 * the Apply screen so the employee sees clashes before submitting.
 */
export function LeaveMonthCalendar({
  month,
  onMonthChange,
  holidays,
  entries,
  weeklyOff = [0, 6],
  highlight,
  className,
}: {
  month: Date;
  onMonthChange: (d: Date) => void;
  holidays: Holiday[];
  entries: TeamCalendarEntry[];
  weeklyOff?: number[];
  highlight?: { start: string; end: string } | null;
  className?: string;
}) {
  const year = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(year, m, 1);
  const startOffset = (first.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, m + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, m, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const holidayByDate = React.useMemo(() => {
    const map = new Map<string, Holiday>();
    for (const h of holidays) map.set(h.date, h);
    return map;
  }, [holidays]);

  const entriesByDate = React.useMemo(() => {
    const map = new Map<string, TeamCalendarEntry[]>();
    for (const e of entries) {
      const s = new Date(e.startDate + 'T00:00:00');
      const end = new Date(e.endDate + 'T00:00:00');
      for (let d = new Date(s); d <= end; d.setDate(d.getDate() + 1)) {
        const key = iso(d);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(e);
      }
    }
    return map;
  }, [entries]);

  const todayIso = iso(new Date());

  return (
    <Card className={cn('p-4', className)}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onMonthChange(new Date(year, m - 1, 1))}
            className="rounded p-1 hover:bg-accent"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => onMonthChange(new Date())}
            className="rounded px-2 py-1 text-xs font-medium hover:bg-accent"
          >
            Today
          </button>
          <button
            onClick={() => onMonthChange(new Date(year, m + 1, 1))}
            className="rounded p-1 hover:bg-accent"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const key = iso(d);
          const holiday = holidayByDate.get(key);
          const dayEntries = entriesByDate.get(key) ?? [];
          const isOff = weeklyOff.includes(d.getDay());
          const inHighlight =
            highlight && highlight.start && highlight.end && key >= highlight.start && key <= highlight.end;
          return (
            <div
              key={key}
              className={cn(
                'min-h-16 rounded-md border p-1 text-left',
                isOff || holiday ? 'bg-muted/60' : 'bg-card',
                inHighlight ? 'border-primary ring-1 ring-primary' : 'border-border',
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    'text-xs font-medium',
                    key === todayIso &&
                      'flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground',
                  )}
                >
                  {d.getDate()}
                </span>
              </div>
              {holiday && (
                <p className="mt-0.5 truncate text-[10px] font-medium text-muted-foreground" title={holiday.name}>
                  {holiday.name}
                </p>
              )}
              <div className="mt-0.5 flex flex-col gap-0.5">
                {dayEntries.slice(0, 3).map((e) => (
                  <span
                    key={e.requestId + key}
                    className="truncate rounded px-1 text-[10px] font-medium text-white"
                    style={{ background: e.colorToken, opacity: e.status === 'APPROVED' ? 1 : 0.55 }}
                    title={`${e.employeeName} · ${e.leaveTypeCode} · ${e.status}`}
                  >
                    {e.employeeName.split(' ')[0]} {e.leaveTypeCode}
                  </span>
                ))}
                {dayEntries.length > 3 && (
                  <span className="px-1 text-[10px] text-muted-foreground">
                    +{dayEntries.length - 3} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
