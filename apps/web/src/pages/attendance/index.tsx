import * as React from 'react';
import { CalendarDays, Coffee, Download, LogIn, LogOut, PencilLine } from 'lucide-react';
import { api, isApiError } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAuth } from '@/context/auth-context';
import { cn } from '@/lib/utils';
import { AttendanceSettingsTab } from './settings-tab';
import { AttendanceTeamTab } from './team-tab';
import { AttendanceApprovalsTab } from './approvals-tab';

interface AttendanceBreakRow {
  id: string;
  startAt: string;
  endAt: string | null;
}
interface AttendanceRecordRow {
  id: string;
  date: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  status: string;
  source: string;
  breaks: AttendanceBreakRow[];
}
interface TodayResponse {
  record: AttendanceRecordRow | null;
  effectiveMs: number;
  isOnBreak: boolean;
  targetHours: number;
  overtimeMs: number;
}
interface StatsResponse {
  daysPresent: number;
  workingDays: number;
  punctualityRate: number;
  remainingLeave: number;
  overtimeHours: number;
}
const REASON_LABELS: Record<string, string> = {
  MISSED_PUNCH_IN: 'Missed Punch In',
  MISSED_PUNCH_OUT: 'Missed Punch Out',
  WRONG_PUNCH_TIME: 'Wrong Punch Time',
  FORGOT_TO_CLOCK_IN: 'Forgot to Clock In',
  FORGOT_TO_CLOCK_OUT: 'Forgot to Clock Out',
  ON_DUTY_FIELD_WORK: 'On-Duty / Field Work',
  OTHER: 'Other',
};

const STATUS_DOT: Record<string, string> = {
  PRESENT: 'bg-lumen-success',
  LATE: 'bg-lumen-warning',
  PENDING_REGULARIZATION: 'bg-lumen-warning',
  ON_LEAVE: 'bg-lumen-info',
  WEEKLY_OFF: 'bg-lumen-text-muted',
  HOLIDAY: 'bg-lumen-text-muted',
  ABSENT: 'bg-lumen-error',
};

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function fmtTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function fmtDuration(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

type Tab = 'my' | 'team' | 'approvals' | 'settings';

export function AttendancePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'COMPANY_ADMIN' || user?.role === 'HR_MANAGER';
  const isManager = user?.role === 'LINE_MANAGER';
  const hasTeamView = isAdmin || isManager;

  const [tab, setTab] = React.useState<Tab>('my');

  if (!hasTeamView) return <MyAttendanceTab />;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
      <TabsList>
        <TabsTrigger value="my">My Attendance</TabsTrigger>
        <TabsTrigger value="team">Team</TabsTrigger>
        <TabsTrigger value="approvals">Approvals</TabsTrigger>
        {isAdmin && <TabsTrigger value="settings">Settings</TabsTrigger>}
      </TabsList>
      <TabsContent value="my">
        <MyAttendanceTab />
      </TabsContent>
      <TabsContent value="team">
        <AttendanceTeamTab canMark={isAdmin} />
      </TabsContent>
      <TabsContent value="approvals">
        <AttendanceApprovalsTab />
      </TabsContent>
      {isAdmin && (
        <TabsContent value="settings">
          <AttendanceSettingsTab />
        </TabsContent>
      )}
    </Tabs>
  );
}

function MyAttendanceTab() {
  const { user } = useAuth();
  const [today, setToday] = React.useState<TodayResponse | null>(null);
  const [stats, setStats] = React.useState<StatsResponse | null>(null);
  const [month, setMonth] = React.useState(new Date());
  const [records, setRecords] = React.useState<AttendanceRecordRow[]>([]);
  const [selected, setSelected] = React.useState<AttendanceRecordRow | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [now, setNow] = React.useState(() => Date.now());

  const load = React.useCallback(async () => {
    const mk = monthKey(month);
    const [t, s, cal] = await Promise.all([
      api.get<TodayResponse>('/attendance/today'),
      api.get<StatsResponse>(`/attendance/stats?month=${mk}`),
      api.get<AttendanceRecordRow[]>(`/attendance/calendar?month=${mk}`),
    ]);
    setToday(t);
    setStats(s);
    setRecords(cal);
  }, [month]);

  React.useEffect(() => {
    setLoading(true);
    load()
      .catch((err) => setError(isApiError(err) ? err.message : 'Failed to load attendance'))
      .finally(() => setLoading(false));
  }, [load]);

  // Live elapsed-timer tick while clocked in.
  React.useEffect(() => {
    if (!today?.record?.checkInAt || today.record.checkOutAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [today]);

  async function runAction(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (!user?.employeeId) {
    return <p className="text-sm text-muted-foreground">This account has no linked employee record.</p>;
  }

  const record = today?.record ?? null;
  const isClockedIn = !!record?.checkInAt && !record.checkOutAt;
  // While clocked in, recompute live from checkInAt on every tick (see the
  // 1s interval above); otherwise trust the server-computed effectiveMs.
  const displayMs =
    today && record?.checkInAt && !record.checkOutAt
      ? now - new Date(record.checkInAt).getTime() - breakMsSoFar(record)
      : (today?.effectiveMs ?? 0);

  const targetMs = (today?.targetHours ?? 8) * 3600 * 1000;
  const pct = Math.min(100, Math.round((displayMs / targetMs) * 100));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Attendance</h1>
          <p className="text-sm text-muted-foreground">
            Real-time shift tracking, verified punch telemetry, and monthly logbook.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setDialogOpen(true)}>
            <PencilLine className="h-4 w-4" /> Request Regularization
          </Button>
          <Button variant="outline" aria-label="Export" className="w-9 px-0">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <Card className="p-6">
            <div className="flex flex-wrap items-center gap-8">
              <ProgressRing pct={pct} targetHours={today?.targetHours ?? 8} />
              <div className="flex flex-1 flex-col gap-1.5">
                <Badge
                  variant={isClockedIn ? 'success' : 'outline'}
                  className="w-fit gap-1.5 border-transparent bg-lumen-success-soft text-lumen-success"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-lumen-success" />
                  {isClockedIn
                    ? `You're clocked in · ${fmtTime(record!.checkInAt)}`
                    : record?.checkOutAt
                      ? `Clocked out · ${fmtTime(record.checkOutAt)}`
                      : 'Not clocked in'}
                </Badge>
                <div className="text-4xl font-bold tabular-nums tracking-tight">
                  {fmtDuration(displayMs)} <span className="text-base font-normal text-muted-foreground">today</span>
                </div>
                {(today?.overtimeMs ?? 0) > 0 && (
                  <div className="text-sm font-medium text-lumen-gold">
                    +{fmtDuration(today!.overtimeMs)} overtime
                  </div>
                )}
                {isClockedIn && (
                  <div className="flex items-center gap-1.5 text-sm text-lumen-success">
                    ✓ On schedule · Expected completion ~{' '}
                    {new Date(new Date(record!.checkInAt!).getTime() + targetMs).toLocaleTimeString(undefined, {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={busy || !isClockedIn}
                  onClick={() =>
                    runAction(() =>
                      api.post(today?.isOnBreak ? '/attendance/break/end' : '/attendance/break/start'),
                    )
                  }
                >
                  <Coffee className="h-4 w-4" /> {today?.isOnBreak ? 'End Break' : 'Take Break'}
                </Button>
                <Button
                  disabled={busy || today?.isOnBreak}
                  onClick={() =>
                    runAction(() => api.post(isClockedIn ? '/attendance/clock-out' : '/attendance/clock-in'))
                  }
                >
                  {isClockedIn ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                  {isClockedIn ? 'Clock Out' : 'Clock In'}
                </Button>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Days Present"
              value={`${stats?.daysPresent ?? 0}`}
              suffix={`/ ${stats?.workingDays ?? 0} working days`}
              footer={stats ? `${Math.round((stats.daysPresent / Math.max(stats.workingDays, 1)) * 100)}% attendance rate` : ''}
              tone="success"
            />
            <StatCard
              label="Punctuality Rate"
              value={`${stats?.punctualityRate ?? 100}%`}
              suffix="on-time arrivals"
              footer=""
              tone="warning"
            />
            <StatCard
              label="Remaining Leave"
              value={`${stats?.remainingLeave ?? 0}`}
              suffix="days balance"
              footer=""
              tone="info"
            />
            <StatCard
              label="Overtime"
              value={`${stats?.overtimeHours ?? 0}h`}
              suffix="this month"
              footer=""
              tone="warning"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
            <CalendarCard
              month={month}
              setMonth={setMonth}
              records={records}
              selected={selected}
              onSelect={setSelected}
            />
            <DetailsPanel record={selected ?? record} />
          </div>
        </>
      )}

      <RegularizationDialog open={dialogOpen} onOpenChange={setDialogOpen} onSubmitted={load} />
    </div>
  );
}

function breakMsSoFar(record: AttendanceRecordRow): number {
  return record.breaks.reduce((sum, b) => {
    const end = b.endAt ? new Date(b.endAt).getTime() : Date.now();
    return sum + (end - new Date(b.startAt).getTime());
  }, 0);
}

function ProgressRing({ pct, targetHours }: { pct: number; targetHours: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <div className="relative flex h-28 w-28 shrink-0 items-center justify-center">
      <svg width="112" height="112" viewBox="0 0 112 112" className="-rotate-90">
        <circle cx="56" cy="56" r={r} fill="none" stroke="var(--lumen-border)" strokeWidth="8" />
        <circle
          cx="56"
          cy="56"
          r={r}
          fill="none"
          stroke="var(--lumen-gold)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Target</span>
        <span className="text-lg font-bold text-lumen-gold">{pct}%</span>
        <span className="text-[10px] text-muted-foreground">{targetHours}h goal</span>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  suffix,
  footer,
  tone,
}: {
  label: string;
  value: string;
  suffix: string;
  footer: string;
  tone: 'success' | 'warning' | 'info';
}) {
  const toneClasses = {
    success: 'bg-lumen-success-soft text-lumen-success',
    warning: 'bg-lumen-warning-soft text-lumen-warning',
    info: 'bg-lumen-info-soft text-lumen-info',
  }[tone];
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className={cn('flex h-7 w-7 items-center justify-center rounded-md', toneClasses)}>
            <CalendarDays className="h-3.5 w-3.5" />
          </span>
        </div>
        <div className="text-2xl font-bold">
          {value} <span className="text-sm font-normal text-muted-foreground">{suffix}</span>
        </div>
        {footer && <div className="mt-2 border-t border-border pt-2 text-xs text-lumen-success">{footer}</div>}
      </CardContent>
    </Card>
  );
}

function CalendarCard({
  month,
  setMonth,
  records,
  selected,
  onSelect,
}: {
  month: Date;
  setMonth: (d: Date) => void;
  records: AttendanceRecordRow[];
  selected: AttendanceRecordRow | null;
  onSelect: (r: AttendanceRecordRow) => void;
}) {
  const byDate = React.useMemo(() => {
    const m = new Map<string, AttendanceRecordRow>();
    for (const r of records) m.set(r.date.slice(0, 10), r);
    return m;
  }, [records]);

  const year = month.getFullYear();
  const monthIdx = month.getMonth();
  const firstOfMonth = new Date(year, monthIdx, 1);
  // Monday-first grid.
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, monthIdx, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold">
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </h3>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMonth(new Date(year, monthIdx - 1, 1))}
            className="rounded p-1 hover:bg-accent"
            aria-label="Previous month"
          >
            ‹
          </button>
          <button
            onClick={() => setMonth(new Date(year, monthIdx + 1, 1))}
            className="rounded p-1 hover:bg-accent"
            aria-label="Next month"
          >
            ›
          </button>
          <button onClick={() => setMonth(new Date())} className="text-sm font-medium text-lumen-gold">
            Today
          </button>
          <div className="hidden items-center gap-3 text-xs text-muted-foreground sm:flex">
            <LegendDot color="bg-lumen-success" label="Present" />
            <LegendDot color="bg-lumen-warning" label="Late / Adjust" />
            <LegendDot color="bg-lumen-info" label="Leave" />
            <LegendDot color="bg-lumen-text-muted" label="Off" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
        {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const iso = d.toISOString().slice(0, 10);
          const rec = byDate.get(iso);
          const isToday = iso === todayIso;
          const isSelected = selected && selected.date.slice(0, 10) === iso;
          return (
            <button
              key={iso}
              disabled={!rec}
              onClick={() => rec && onSelect(rec)}
              className={cn(
                'flex aspect-square flex-col items-center justify-center gap-0.5 rounded-md text-sm transition-colors',
                isSelected
                  ? 'bg-lumen-navy text-white'
                  : isToday
                    ? 'bg-lumen-gold-soft text-foreground'
                    : rec
                      ? 'hover:bg-accent'
                      : 'text-muted-foreground/50',
              )}
            >
              <span className="font-medium">{d.getDate()}</span>
              {rec && (
                <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[rec.status] ?? 'bg-lumen-text-muted')} />
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn('h-1.5 w-1.5 rounded-full', color)} /> {label}
    </span>
  );
}

function DetailsPanel({ record }: { record: AttendanceRecordRow | null }) {
  if (!record) {
    return (
      <Card className="p-5">
        <p className="text-sm text-muted-foreground">Select a day on the calendar to see its details.</p>
      </Card>
    );
  }
  const breakMs = breakMsSoFar(record);
  const grossEnd = record.checkOutAt ? new Date(record.checkOutAt).getTime() : Date.now();
  const effectiveMs = record.checkInAt ? Math.max(grossEnd - new Date(record.checkInAt).getTime() - breakMs, 0) : 0;
  const isClockedIn = !!record.checkInAt && !record.checkOutAt;

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Details</div>
          <div className="text-lg font-semibold">
            {new Date(record.date).toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
            })}
          </div>
        </div>
        <Badge variant={isClockedIn ? 'success' : 'outline'}>{isClockedIn ? 'Clocked In' : record.status.replace(/_/g, ' ')}</Badge>
      </div>
      <div className="flex flex-col gap-2">
        <DetailRow icon={<LogIn className="h-4 w-4" />} label="Clocked In" value={fmtTime(record.checkInAt)} sub="Web Portal" />
        <DetailRow
          icon={<LogOut className="h-4 w-4" />}
          label="Clocked Out"
          value={record.checkOutAt ? fmtTime(record.checkOutAt) : 'In Progress'}
          sub={record.checkOutAt ? undefined : 'Est. —'}
        />
        <div className="flex items-center justify-between rounded-md bg-lumen-surface-2 px-3 py-2.5 text-sm">
          <span className="flex items-center gap-2 text-muted-foreground">
            <Coffee className="h-4 w-4" /> Effective Duration
          </span>
          <span className="font-medium">
            {fmtDuration(effectiveMs)}
            {record.breaks.length > 0 && (
              <span className="ml-1.5 text-xs text-lumen-success">
                ({Math.round(breakMs / 60000)}m break)
              </span>
            )}
          </span>
        </div>
      </div>
    </Card>
  );
}

function DetailRow({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-md bg-lumen-surface-2 px-3 py-2.5 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        {icon} {label}
      </span>
      <span className="text-right">
        <span className="font-medium">{value}</span>
        {sub && <span className="ml-1.5 text-xs text-muted-foreground">{sub}</span>}
      </span>
    </div>
  );
}

function RegularizationDialog({
  open,
  onOpenChange,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted: () => void;
}) {
  const [form, setForm] = React.useState({
    targetDate: '',
    reasonType: 'MISSED_PUNCH_OUT',
    checkIn: '',
    checkOut: '',
    note: '',
  });
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/attendance/regularization', {
        targetDate: form.targetDate,
        reasonType: form.reasonType,
        requestedCheckInAt: form.checkIn ? `${form.targetDate}T${form.checkIn}:00` : undefined,
        requestedCheckOutAt: form.checkOut ? `${form.targetDate}T${form.checkOut}:00` : undefined,
        note: form.note || undefined,
      });
      onOpenChange(false);
      setForm({ targetDate: '', reasonType: 'MISSED_PUNCH_OUT', checkIn: '', checkOut: '', note: '' });
      onSubmitted();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Failed to submit request');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader
          title="Quick Regularization"
          description="Submit a correction for supervisor approval."
          onClose={() => onOpenChange(false)}
        />
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Target Date</Label>
            <Input
              type="date"
              required
              value={form.targetDate}
              onChange={(e) => setForm((f) => ({ ...f, targetDate: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Reason Type</Label>
            <select
              className="h-9 rounded-md border border-input bg-card px-2 text-sm"
              value={form.reasonType}
              onChange={(e) => setForm((f) => ({ ...f, reasonType: e.target.value }))}
            >
              {Object.entries(REASON_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Punch In Time</Label>
              <Input
                type="time"
                value={form.checkIn}
                onChange={(e) => setForm((f) => ({ ...f, checkIn: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Punch Out Time</Label>
              <Input
                type="time"
                value={form.checkOut}
                onChange={(e) => setForm((f) => ({ ...f, checkOut: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Note / Justification</Label>
            <textarea
              className="min-h-20 rounded-md border border-input bg-card px-2 py-1.5 text-sm"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy}
              className="bg-lumen-gold text-lumen-navy hover:opacity-90"
            >
              {busy ? 'Submitting…' : 'Submit Request'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
