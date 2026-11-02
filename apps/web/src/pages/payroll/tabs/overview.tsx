import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import * as payroll from '@/lib/payroll/client';
import type { PayrollRunSummary, Readiness } from '@/lib/payroll/types';
import { useAuth } from '@/context/auth-context';
import { isPayrollAdmin } from '@/lib/roles';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SkeletonRows } from '@/components/ui/skeleton';
import { Money } from '../components/money';
import { RunStatusBadge } from '../components/status-badge';
import { RunStepper } from '../components/run-stepper';
import { StatTile } from '../components/stat-tile';
import { ReadinessPanel } from '../components/readiness-panel';
import { currentPeriod, periodLabel } from '../components/format';

const HINT: Record<PayrollRunSummary['status'], string> = {
  DRAFT: 'Review the numbers and submit the run for approval.',
  REVIEW: 'Waiting on approvals from two different Company Admins.',
  APPROVED: 'Approved — ready to process and generate payslips.',
  PROCESSED: 'Payslips are generated. Disburse once the transfer is done.',
  DISBURSED: 'Paid. Nothing left to do this month.',
};

export function OverviewTab() {
  const { user } = useAuth();
  const canManage = isPayrollAdmin(user);
  const [, setParams] = useSearchParams();
  const period = currentPeriod();

  const [runs, setRuns] = React.useState<PayrollRunSummary[] | null>(null);
  const [readiness, setReadiness] = React.useState<Readiness | null>(null);
  const [readinessLoading, setReadinessLoading] = React.useState(canManage);

  React.useEffect(() => {
    payroll.listRuns().then(setRuns).catch(() => setRuns([]));
    if (canManage) {
      payroll
        .getReadiness(period)
        .then(setReadiness)
        .catch(() => setReadiness(null))
        .finally(() => setReadinessLoading(false));
    }
  }, [canManage, period]);

  if (!runs) return <SkeletonRows rows={6} />;

  const current = runs.find((r) => r.period === period);
  // Latest run per month, newest first.
  const history = runs.filter((r, i) => runs.findIndex((x) => x.period === r.period) === i).slice(0, 6);
  const open = (id: string) => setParams({ tab: 'runs', run: id });

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardDescription>This month</CardDescription>
            <CardTitle className="mt-1 flex flex-wrap items-center gap-2 text-xl">
              {periodLabel(period)}
              {current ? <RunStatusBadge status={current.status} /> : <span className="text-sm font-normal text-muted-foreground">Not started</span>}
            </CardTitle>
          </div>
          {current ? (
            <Button onClick={() => open(current.id)}>
              Open run <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            canManage && <Button onClick={() => setParams({ tab: 'runs', new: '1' })}>Start {periodLabel(period)} run</Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {current ? (
            <>
              <RunStepper status={current.status} />
              <p className="text-sm text-muted-foreground">
                {HINT[current.status]}
                {current.status === 'REVIEW' ? ` (${current.approvalCount} of 2 so far)` : ''}
              </p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatTile label="Net pay" value={<Money value={current.netTotal} />} />
                <StatTile label="Gross" value={<Money value={current.grossTotal} />} />
                <StatTile label="Employer cost" value={<Money value={current.employerCost} />} />
                <StatTile
                  label="Employees paid"
                  value={current.lineItemCount}
                  caption={current.exceptionCount > 0 ? `${current.exceptionCount} exception${current.exceptionCount === 1 ? '' : 's'}` : 'No exceptions'}
                />
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No run exists for {periodLabel(period)} yet. {canManage ? 'Check the readiness list on the right, then start the run.' : ''}
            </p>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Needs attention</CardTitle>
            <CardDescription>Checked against {periodLabel(period)}</CardDescription>
          </CardHeader>
          <CardContent>
            <ReadinessPanel readiness={readiness} loading={readinessLoading} />
          </CardContent>
        </Card>
      )}

      <Card className="lg:col-span-3">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Recent months</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setParams({ tab: 'runs' })}>
            All runs <ArrowRight className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {history.map((r) => (
                <button
                  key={r.id}
                  onClick={() => open(r.id)}
                  className="flex flex-col gap-1.5 rounded-xl border border-border/60 bg-secondary/40 px-4 py-3 text-left hover:bg-accent/50"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{periodLabel(r.period)}</span>
                    <RunStatusBadge status={r.status} />
                  </span>
                  <Money value={r.netTotal} className="text-lg font-semibold" />
                  <span className="text-xs text-muted-foreground">{r.lineItemCount} employees</span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
