import * as React from 'react';
import { ArrowLeft, CheckCircle2, Circle, Download, Lock, RefreshCw, TriangleAlert } from 'lucide-react';
import * as payroll from '@/lib/payroll/client';
import type { PayrollRunStatus, RunSummary } from '@/lib/payroll/types';
import { useAuth } from '@/context/auth-context';
import { isAuditor, isPayrollAdmin } from '@/lib/roles';
import { isApiError } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonRows } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { RunStatusBadge } from './components/status-badge';
import { RunStepper } from './components/run-stepper';
import { StatTile, Delta } from './components/stat-tile';
import { Money, formatMoney } from './components/money';
import { ConfirmDialog, type ConfirmRequest } from './components/confirm-dialog';
import { BankFileDialog } from './components/bank-file-dialog';
import { ReviewTable } from './components/review-table';
import { EmployeeDrawer } from './components/employee-drawer';
import { fmtDateTime, pctChange, periodLabel } from './components/format';

const NEXT_HINT: Record<PayrollRunStatus, string> = {
  DRAFT: 'Review the numbers below and adjust anyone who needs it, then submit the run for approval.',
  REVIEW: 'Two different Company Admins must approve before the run can be processed.',
  APPROVED: 'Both approvals are in. Processing locks the run and generates every payslip.',
  PROCESSED: 'The run is locked and payslips are generated. Disburse once the bank transfer is done.',
  DISBURSED: 'This run is complete.',
};

export function RunPage({ runId, onBack }: { runId: string; onBack: () => void }) {
  const { user } = useAuth();
  const canManage = isPayrollAdmin(user);
  const auditor = isAuditor(user);
  const { toast } = useToast();

  const [summary, setSummary] = React.useState<RunSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState(0);
  const [confirm, setConfirm] = React.useState<ConfirmRequest | null>(null);
  const [openEmployee, setOpenEmployee] = React.useState<string | null>(null);
  const [bankFileOpen, setBankFileOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setSummary(await payroll.getRunSummary(runId));
      setError(null);
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not load this run');
    }
  }, [runId]);

  React.useEffect(() => {
    setSummary(null);
    load();
  }, [load]);

  async function act(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await fn();
      toast({ title: done, tone: 'success' });
      await load();
      setVersion((v) => v + 1);
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'That didn’t work — try again', tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" className="w-fit" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> All runs
        </Button>
        <EmptyState
          icon={TriangleAlert}
          title="Couldn’t load this run"
          description={error}
          action={
            <Button size="sm" onClick={load}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          }
        />
      </div>
    );
  }
  if (!summary) return <SkeletonRows rows={6} />;

  const { run, totals, approvals, previous } = summary;
  const locked = run.status === 'PROCESSED' || run.status === 'DISBURSED';
  const iApproved = approvals.some((a) => a.approverId === user?.sub);
  const disabled = busy !== null;
  const netDelta = previous ? pctChange(totals.net, previous.net) : null;

  const askConfirm = (title: string, body: React.ReactNode, label: string, key: string, fn: () => Promise<unknown>, done: string) =>
    setConfirm({ title, body, confirmLabel: label, onConfirm: () => act(key, fn, done) });

  return (
    <div className="flex flex-col gap-4">
      <Button variant="ghost" size="sm" className="w-fit" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" /> All runs
      </Button>

      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
              {periodLabel(run.period)}
              <RunStatusBadge status={run.status} />
              {locked && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Locked" />}
              {run.isReprocess && <span className="text-xs font-normal text-muted-foreground">(re-process)</span>}
            </CardTitle>
            <CardDescription>
              Prepared by {run.preparedByName ?? 'unknown'} · {fmtDateTime(run.createdAt)}
              {run.reprocessReason ? ` · ${run.reprocessReason}` : ''}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Employees paid" value={totals.headcount} caption={previous ? `${previous.headcount} last month` : undefined} />
            <StatTile label="Gross" value={<Money value={totals.gross} />} />
            <StatTile label="Net pay" value={<Money value={totals.net} />} caption={<Delta pct={netDelta} />} />
            <StatTile label="Employer cost" value={<Money value={totals.employerCost} />} caption={`incl. ${formatMoney(totals.employerContributions)} contributions`} />
          </div>
          <RunStepper status={run.status} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {run.status === 'DISBURSED' ? 'Completed' : 'Next step'}
          </CardTitle>
          <CardDescription>{NEXT_HINT[run.status]}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {(run.status === 'REVIEW' || approvals.length > 0) && (
            <div className="grid gap-2 sm:grid-cols-2">
              {[0, 1].map((slot) => {
                const a = approvals[slot];
                return (
                  <div
                    key={slot}
                    className="flex items-center gap-3 rounded-xl border border-border/60 bg-secondary/40 px-4 py-3 text-sm"
                  >
                    {a ? <CheckCircle2 className="h-5 w-5 text-success" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
                    <div>
                      <p className="font-medium">{a ? (a.approverName ?? 'An admin') : `Approval ${slot + 1} pending`}</p>
                      <p className="text-xs text-muted-foreground">
                        {a ? fmtDateTime(a.approvedAt) : 'Waiting for a Company Admin'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              {(run.status === 'DRAFT' || run.status === 'REVIEW') && (
                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={() => act('recalc', () => payroll.recalculateRun(runId), 'Recalculated')}
                >
                  <RefreshCw className="h-4 w-4" /> {busy === 'recalc' ? 'Recalculating…' : 'Recalculate'}
                </Button>
              )}
              {run.status === 'DRAFT' && (
                <Button disabled={disabled} onClick={() => act('review', () => payroll.submitForReview(runId), 'Submitted for review')}>
                  Submit for review
                </Button>
              )}
              {run.status === 'REVIEW' && (
                <Button
                  disabled={disabled || iApproved}
                  onClick={() =>
                    askConfirm(
                      'Approve this run?',
                      <>You’re approving <strong>{totals.headcount} payslips</strong> totalling <Money value={totals.net} className="font-medium text-foreground" /> net pay. Two different admins must approve.</>,
                      'Approve',
                      'approve',
                      () => payroll.approveRun(runId),
                      'Approval recorded',
                    )
                  }
                >
                  Approve ({approvals.length} of 2)
                </Button>
              )}
              {run.status === 'REVIEW' && iApproved && (
                <span className="text-xs text-muted-foreground">You’ve approved — a second admin needs to approve.</span>
              )}
              {run.status === 'APPROVED' && (
                <Button
                  disabled={disabled}
                  onClick={() =>
                    askConfirm(
                      'Process this run?',
                      'The run becomes immutable and a password-protected payslip is generated for every employee. This can’t be undone.',
                      'Process run',
                      'process',
                      () => payroll.processRun(runId),
                      'Run processed — payslips generated',
                    )
                  }
                >
                  {busy === 'process' ? 'Processing…' : 'Process run'}
                </Button>
              )}
              {run.status === 'PROCESSED' && (
                <Button
                  disabled={disabled}
                  onClick={() =>
                    askConfirm('Disburse this run?', 'Mark salaries as paid. This is irreversible.', 'Disburse', 'disburse', () => payroll.disburseRun(runId), 'Run disbursed')
                  }
                >
                  Disburse
                </Button>
              )}
              {locked && (
                <Button variant="outline" onClick={() => setBankFileOpen(true)}>
                  <Download className="h-4 w-4" /> Bank file
                </Button>
              )}
            </div>
          )}
          {run.status === 'PROCESSED' && run.processedAt && (
            <p className="text-xs text-muted-foreground">Processed {fmtDateTime(run.processedAt)}</p>
          )}
          {run.status === 'DISBURSED' && run.disbursedAt && (
            <p className="text-xs text-muted-foreground">Disbursed {fmtDateTime(run.disbursedAt)}</p>
          )}
        </CardContent>
      </Card>

      {run.exceptions.length > 0 && (
        <details className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm" open={!locked}>
          <summary className="cursor-pointer font-medium text-warning">
            {run.exceptions.length} {run.exceptions.length === 1 ? 'exception' : 'exceptions'} in this run
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-warning">
            {run.exceptions.map((e, i) => (
              <li key={i}>
                <strong>{e.type}</strong> — {e.detail}
              </li>
            ))}
          </ul>
        </details>
      )}

      {summary.departments.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Net pay by department</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {summary.departments.slice(0, 8).map((d) => {
              const share = Number(totals.net) ? (Number(d.net) / Number(totals.net)) * 100 : 0;
              return (
                <div key={d.name} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[12rem_1fr_auto]">
                  <span className="truncate">
                    {d.name} <span className="text-xs text-muted-foreground">({d.headcount})</span>
                  </span>
                  <span className="h-2 overflow-hidden rounded-full bg-secondary">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                  </span>
                  <Money value={d.net} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {auditor ? (
        <p className="text-sm text-muted-foreground">
          Auditor view — totals and the approval trail only, no per-employee amounts.
        </p>
      ) : (
        <>
          <h2 className="-mb-2 text-base font-semibold">Employees</h2>
          <ReviewTable runId={runId} version={version} onOpen={setOpenEmployee} />
        </>
      )}

      <EmployeeDrawer
        runId={runId}
        period={run.period}
        employeeId={openEmployee}
        canAdjust={canManage}
        locked={locked}
        onClose={() => setOpenEmployee(null)}
        onChanged={() => {
          load();
          setVersion((v) => v + 1);
        }}
      />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
      {bankFileOpen && <BankFileDialog runId={runId} onClose={() => setBankFileOpen(false)} />}
    </div>
  );
}
