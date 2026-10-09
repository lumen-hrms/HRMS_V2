import * as React from 'react';
import { AlertTriangle, Lock, RefreshCw } from 'lucide-react';
import * as payroll from '@/lib/payroll/client';
import type { PayrollLineItem, PayrollRun } from '@/lib/payroll/types';
import { useAuth } from '@/context/auth-context';
import { isPayrollAdmin } from '@/lib/roles';
import { isApiError } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonRows } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Money } from '../components/money';
import { RunStatusBadge } from '../components/status-badge';
import { AdjustmentsDialog } from '../components/adjustments-dialog';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function RunTab() {
  const { user } = useAuth();
  const canManage = isPayrollAdmin(user);
  const { toast } = useToast();

  const [period, setPeriod] = React.useState(new Date().toISOString().slice(0, 7));
  const [isReprocess, setIsReprocess] = React.useState(false);
  const [reprocessReason, setReprocessReason] = React.useState('');
  const [runIdInput, setRunIdInput] = React.useState('');
  const [openRunId, setOpenRunId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [recent, setRecent] = React.useState(payroll.recentRuns());

  async function create() {
    setCreating(true);
    try {
      const run = await payroll.createRun({
        period,
        isReprocess: isReprocess || undefined,
        reprocessReason: isReprocess ? reprocessReason : undefined,
      });
      payroll.rememberRun(run.id, run.period);
      setRecent(payroll.recentRuns());
      setOpenRunId(run.id);
      toast({ title: `Run created for ${run.period}`, tone: 'success' });
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Could not create run', tone: 'error' });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {!openRunId && (
        <Card className="p-5">
          <h3 className="mb-1 text-sm font-semibold">Open a payroll run</h3>
          <p className="mb-4 text-xs text-muted-foreground">
            There's no run list endpoint yet — create a new run for a period, open one by its
            id, or pick up a run this browser recently opened.
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {canManage && (
              <div className="flex flex-col gap-3 rounded-md border border-border p-4">
                <Field label="Period">
                  <Input
                    placeholder="YYYY-MM"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                  />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input"
                    checked={isReprocess}
                    onChange={(e) => setIsReprocess(e.target.checked)}
                  />
                  This is a re-process of an already-processed period
                </label>
                {isReprocess && (
                  <Field label="Reason" required hint="Minimum 10 characters.">
                    <Textarea
                      value={reprocessReason}
                      onChange={(e) => setReprocessReason(e.target.value)}
                    />
                  </Field>
                )}
                <Button
                  disabled={
                    creating ||
                    !PERIOD_RE.test(period) ||
                    (isReprocess && reprocessReason.trim().length < 10)
                  }
                  onClick={create}
                >
                  {creating ? 'Creating…' : 'Create run'}
                </Button>
              </div>
            )}

            <div className="flex flex-col gap-3 rounded-md border border-border p-4">
              <Field label="Open by run id">
                <div className="flex gap-2">
                  <Input value={runIdInput} onChange={(e) => setRunIdInput(e.target.value)} />
                  <Button variant="outline" disabled={!runIdInput} onClick={() => setOpenRunId(runIdInput)}>
                    Open
                  </Button>
                </div>
              </Field>
              {recent.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs text-muted-foreground">Recently opened</p>
                  <div className="flex flex-col gap-1">
                    {recent.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => setOpenRunId(r.id)}
                        className="rounded px-2 py-1 text-left text-sm hover:bg-accent"
                      >
                        {r.period} <span className="text-muted-foreground">· {r.id.slice(0, 8)}…</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {openRunId && <RunDetail runId={openRunId} onClose={() => setOpenRunId(null)} />}
    </div>
  );
}

function RunDetail({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { user } = useAuth();
  const canManage = isPayrollAdmin(user);
  const { toast } = useToast();
  const [run, setRun] = React.useState<PayrollRun | null>(null);
  const [error, setError] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [adjustFor, setAdjustFor] = React.useState<PayrollLineItem | null>(null);

  const load = React.useCallback(async () => {
    setError(false);
    try {
      const r = await payroll.getRun(runId);
      setRun(r);
      payroll.rememberRun(runId, r.period);
    } catch {
      setError(true);
    }
  }, [runId]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function action(key: string, fn: () => Promise<unknown>, label: string) {
    setBusy(key);
    try {
      await fn();
      toast({ title: label, tone: 'success' });
      await load();
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Action failed', tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function downloadBankFile() {
    try {
      const { filename, mimeType, content, skippedEmployeeCount } = await payroll.getBankFile(runId);
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      if (skippedEmployeeCount > 0) {
        toast({
          title: `Bank file downloaded — ${skippedEmployeeCount} employee(s) skipped`,
          description: 'Missing bank account details on file.',
          tone: 'info',
        });
      }
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Could not download bank file', tone: 'error' });
    }
  }

  async function openPayslip(employeeId: string) {
    if (!run) return;
    try {
      const { url } = await payroll.getPayslipUrl(employeeId, run.period);
      window.open(url, '_blank', 'noopener');
    } catch {
      toast({ title: 'No payslip for this employee/period', tone: 'info' });
    }
  }

  if (error) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load this run"
        action={
          <Button size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4" /> Retry
          </Button>
        }
      />
    );
  }
  if (!run) return <SkeletonRows rows={5} />;

  const isReducedView = run.lineItems === undefined;
  const locked = run.status === 'PROCESSED' || run.status === 'DISBURSED';
  const approvalCount = run.approvals.length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            {run.period}
            {locked && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
            <RunStatusBadge status={run.status} />
            {run.isReprocess && <span className="text-xs text-muted-foreground">(re-process)</span>}
          </CardTitle>
          <CardDescription>
            {isReducedView
              ? `${run.lineItemCount ?? 0} line items · ${run.exceptionCount ?? 0} exceptions`
              : `${run.lineItems!.length} line items`}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {run.exceptions.length > 0 && (
          <div className="flex flex-col gap-1 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
            {run.exceptions.map((e, i) => (
              <div key={i}>
                <strong>{e.type}</strong> — {e.detail}
              </div>
            ))}
          </div>
        )}

        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            {run.status === 'DRAFT' && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => action('recalc', () => payroll.recalculateRun(runId), 'Recalculated')}
                >
                  Recalculate
                </Button>
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    action('review', () => payroll.submitForReview(runId), 'Submitted for review')
                  }
                >
                  Submit for review
                </Button>
              </>
            )}
            {run.status === 'REVIEW' && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => action('recalc', () => payroll.recalculateRun(runId), 'Recalculated')}
                >
                  Recalculate
                </Button>
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    action(
                      'approve',
                      async () => {
                        if (!confirm('Approve this run? Two distinct approvers are required.')) {
                          throw new Error('cancelled');
                        }
                        await payroll.approveRun(runId);
                      },
                      'Approval recorded',
                    )
                  }
                >
                  Approve ({approvalCount} of 2)
                </Button>
              </>
            )}
            {run.status === 'APPROVED' && (
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() =>
                  action(
                    'process',
                    async () => {
                      if (!confirm('Process this run? It becomes immutable afterwards.')) {
                        throw new Error('cancelled');
                      }
                      await payroll.processRun(runId);
                    },
                    'Run processed — payslips generated',
                  )
                }
              >
                Process
              </Button>
            )}
            {run.status === 'PROCESSED' && (
              <>
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    action(
                      'disburse',
                      async () => {
                        if (!confirm('Disburse this run? This is irreversible.')) {
                          throw new Error('cancelled');
                        }
                        await payroll.disburseRun(runId);
                      },
                      'Run disbursed',
                    )
                  }
                >
                  Disburse
                </Button>
                <Button size="sm" variant="outline" onClick={downloadBankFile}>
                  Download bank file (CSV)
                </Button>
              </>
            )}
            {run.status === 'DISBURSED' && (
              <Button size="sm" variant="outline" onClick={downloadBankFile}>
                Download bank file (CSV)
              </Button>
            )}
          </div>
        )}

        {run.approvals.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Approved by: {run.approvals.map((a) => a.approverId.slice(0, 8)).join(', ')}
          </div>
        )}

        {isReducedView ? (
          <p className="text-sm text-muted-foreground">
            Auditor view — run summary and approval trail only, no per-employee amounts.
          </p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH className="text-right">Gross</TH>
                <TH className="text-right">EPF</TH>
                <TH className="text-right">ESI</TH>
                <TH className="text-right">PT</TH>
                <TH className="text-right">TDS</TH>
                <TH className="text-right">Net pay</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {run.lineItems!.map((li) => (
                <TR key={li.id}>
                  <TD className="font-mono text-xs">{li.employeeId.slice(0, 8)}…</TD>
                  <TD className="text-right"><Money value={li.grossEarnings} /></TD>
                  <TD className="text-right"><Money value={li.epfEmployee} /></TD>
                  <TD className="text-right"><Money value={li.esiEmployee} /></TD>
                  <TD className="text-right"><Money value={li.professionalTax} /></TD>
                  <TD className="text-right"><Money value={li.tdsDeducted} /></TD>
                  <TD className="text-right font-medium"><Money value={li.netPay} /></TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-1">
                      {canManage && !locked && (
                        <Button size="sm" variant="outline" onClick={() => setAdjustFor(li)}>
                          Adjust
                        </Button>
                      )}
                      {locked && (
                        <Button size="sm" variant="outline" onClick={() => openPayslip(li.employeeId)}>
                          Payslip
                        </Button>
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>

      <AdjustmentsDialog
        runId={runId}
        employeeId={adjustFor?.employeeId ?? null}
        initial={adjustFor?.adHocAdjustments ?? []}
        open={adjustFor !== null}
        onOpenChange={(v) => !v && setAdjustFor(null)}
        onSaved={load}
      />
    </Card>
  );
}

