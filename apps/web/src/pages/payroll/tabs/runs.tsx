import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, WalletCards } from 'lucide-react';
import * as payroll from '@/lib/payroll/client';
import type { PayrollRunSummary, PayrollRunStatus, Readiness } from '@/lib/payroll/types';
import { useAuth } from '@/context/auth-context';
import { isPayrollAdmin } from '@/lib/roles';
import { isApiError } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { Money } from '../components/money';
import { RunStatusBadge } from '../components/status-badge';
import { ReadinessPanel } from '../components/readiness-panel';
import { currentPeriod, periodLabel } from '../components/format';
import { RunPage } from '../run-page';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const READINESS_DEBOUNCE_MS = 400;
const STATUSES: PayrollRunStatus[] = ['DRAFT', 'REVIEW', 'APPROVED', 'PROCESSED', 'DISBURSED'];

function NewRunDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { toast } = useToast();
  const [period, setPeriod] = React.useState(currentPeriod());
  const [reprocess, setReprocess] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [readiness, setReadiness] = React.useState<Readiness | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [creating, setCreating] = React.useState(false);

  const periodValid = PERIOD_RE.test(period);
  React.useEffect(() => {
    if (!periodValid) return;
    let stale = false;
    setLoading(true);
    setAcknowledged(false);
    const t = window.setTimeout(() => {
      payroll
        .getReadiness(period)
        .then((r) => !stale && setReadiness(r))
        .catch(() => !stale && setReadiness(null))
        .finally(() => !stale && setLoading(false));
    }, READINESS_DEBOUNCE_MS);
    return () => {
      stale = true;
      window.clearTimeout(t);
    };
  }, [period, periodValid]);

  const blockers = readiness?.blockers.reduce((n, g) => n + g.count, 0) ?? 0;
  const periodError = period && !periodValid ? 'Use the format YYYY-MM, e.g. 2026-11' : undefined;
  const reasonError = reprocess && reason.trim().length > 0 && reason.trim().length < 10 ? 'Give a reason of at least 10 characters' : undefined;
  const canCreate =
    periodValid && !creating && (!reprocess || reason.trim().length >= 10) && (blockers === 0 || acknowledged);

  async function create() {
    setCreating(true);
    try {
      const run = await payroll.createRun({
        period,
        isReprocess: reprocess || undefined,
        reprocessReason: reprocess ? reason.trim() : undefined,
      });
      toast({ title: `Run created for ${periodLabel(run.period)}`, tone: 'success' });
      onCreated(run.id);
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Could not create the run', tone: 'error' });
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader title="Start a payroll run" onClose={onClose} />
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
          <Field label="Month" required error={periodError} hint={periodValid ? periodLabel(period) : 'YYYY-MM'}>
            <Input value={period} onChange={(e) => setPeriod(e.target.value.trim())} maxLength={7} placeholder="2026-11" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 rounded border-input" checked={reprocess} onChange={(e) => setReprocess(e.target.checked)} />
            This month was already processed — re-process it
          </label>
          {reprocess && (
            <Field label="Reason" required error={reasonError} hint="At least 10 characters. Recorded in the audit log.">
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            </Field>
          )}
          {periodValid && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Before you start</p>
              {readiness?.existingRun && !reprocess && (
                <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  A run for this month already exists ({readiness.existingRun.status}). Creating another needs a re-process.
                </p>
              )}
              <ReadinessPanel readiness={readiness} loading={loading} />
              {blockers > 0 && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-input" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                  I understand {blockers} {blockers === 1 ? 'employee' : 'employees'} will be left out of this run.
                </label>
              )}
            </div>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canCreate} onClick={create}>
            {creating ? 'Creating…' : 'Create run'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RunsTab() {
  const { user } = useAuth();
  const canManage = isPayrollAdmin(user);
  const [params, setParams] = useSearchParams();
  const runId = params.get('run');
  const newOpen = params.get('new') === '1';

  const [runs, setRuns] = React.useState<PayrollRunSummary[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [year, setYear] = React.useState('');

  const load = React.useCallback(() => {
    setError(null);
    payroll
      .listRuns()
      .then(setRuns)
      .catch((err) => {
        setRuns([]);
        setError(isApiError(err) ? err.message : 'Could not load payroll runs');
      });
  }, []);
  // Reload whenever the list is back on screen so another admin's approvals show up.
  React.useEffect(() => {
    if (!runId) load();
  }, [runId, load]);

  if (runId) return <RunPage runId={runId} onBack={() => setParams({ tab: 'runs' })} />;

  const years = [...new Set((runs ?? []).map((r) => r.period.slice(0, 4)))];
  const q = search.trim().toLowerCase();
  const filtered = (runs ?? []).filter(
    (r) =>
      (!status || r.status === status) &&
      (!year || r.period.startsWith(year)) &&
      (!q || r.period.includes(q) || periodLabel(r.period).toLowerCase().includes(q)),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search month, e.g. Nov 2026" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" aria-label="Search runs" />
        </div>
        <Select className="w-40" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </option>
          ))}
        </Select>
        {years.length > 1 && (
          <Select className="w-32" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year">
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        )}
        {canManage && (
          <Button className="ml-auto" onClick={() => setParams({ tab: 'runs', new: '1' })}>
            <Plus className="h-4 w-4" /> New run
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        {error ? (
          <div className="flex items-center justify-between gap-2 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={load}>
              Retry
            </Button>
          </div>
        ) : !runs ? (
          <div className="p-4">
            <SkeletonRows rows={5} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={WalletCards}
            title={runs.length === 0 ? 'No payroll runs yet' : 'No runs match these filters'}
            description={runs.length === 0 && canManage ? 'Start your first run to calculate this month’s pay.' : undefined}
            action={runs.length === 0 && canManage ? <Button onClick={() => setParams({ tab: 'runs', new: '1' })}>Start a run</Button> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Month</TH>
                  <TH>Status</TH>
                  <TH className="hidden text-right md:table-cell">Employees</TH>
                  <TH className="hidden text-right lg:table-cell">Gross</TH>
                  <TH className="text-right">Net pay</TH>
                  <TH className="hidden text-right lg:table-cell">Employer cost</TH>
                  <TH className="hidden sm:table-cell">Approvals</TH>
                  <TH className="hidden xl:table-cell">Prepared by</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => (
                  <TR
                    key={r.id}
                    className="cursor-pointer hover:bg-accent/50"
                    tabIndex={0}
                    onClick={() => setParams({ tab: 'runs', run: r.id })}
                    onKeyDown={(e) => e.key === 'Enter' && setParams({ tab: 'runs', run: r.id })}
                  >
                    <TD className="font-medium">
                      {periodLabel(r.period)}
                      {r.isReprocess && <span className="ml-1.5 text-xs font-normal text-muted-foreground">re-process</span>}
                    </TD>
                    <TD>
                      <RunStatusBadge status={r.status} />
                    </TD>
                    <TD className="hidden text-right tabular-nums md:table-cell">{r.lineItemCount}</TD>
                    <TD className="hidden text-right lg:table-cell"><Money value={r.grossTotal} /></TD>
                    <TD className="text-right font-medium"><Money value={r.netTotal} /></TD>
                    <TD className="hidden text-right lg:table-cell"><Money value={r.employerCost} /></TD>
                    <TD className="hidden tabular-nums sm:table-cell">
                      {r.status === 'DRAFT' ? '—' : r.status === 'REVIEW' ? `${r.approvalCount} of 2` : '2 of 2'}
                    </TD>
                    <TD className="hidden text-muted-foreground xl:table-cell">{r.preparedByName ?? '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>

      {newOpen && (
        <NewRunDialog
          onClose={() => setParams({ tab: 'runs' })}
          onCreated={(id) => setParams({ tab: 'runs', run: id })}
        />
      )}
    </div>
  );
}
