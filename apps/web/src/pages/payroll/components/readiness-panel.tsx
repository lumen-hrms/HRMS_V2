import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type { Readiness, ReadinessGroup } from '@/lib/payroll/types';
import { Button } from '@/components/ui/button';
import { SkeletonRows } from '@/components/ui/skeleton';

function Group({ group, tone }: { group: ReadinessGroup; tone: 'blocker' | 'warning' }) {
  const [, setParams] = useSearchParams();
  const shown = group.employees.slice(0, 4);
  return (
    <div
      className={
        tone === 'blocker'
          ? 'rounded-xl border border-destructive/30 bg-destructive/10 p-3'
          : 'rounded-xl border border-warning/30 bg-warning/10 p-3'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={tone === 'blocker' ? 'text-sm font-medium text-destructive' : 'text-sm font-medium text-warning'}>
          {group.label} · {group.count} {group.count === 1 ? 'employee' : 'employees'}
        </p>
        <Button size="sm" variant="outline" onClick={() => setParams({ tab: 'people', filter: group.type })}>
          Fix in People &amp; Pay
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{group.help}</p>
      <p className="mt-1.5 text-xs">
        {shown.map((e) => e.name).join(', ')}
        {group.count > shown.length ? ` and ${group.count - shown.length} more` : ''}
      </p>
    </div>
  );
}

/** What would leave someone out of (or degrade) a payroll run — checked before the run is created. */
export function ReadinessPanel({
  readiness,
  loading,
}: {
  readiness: Readiness | null;
  loading: boolean;
}) {
  if (loading || !readiness) return <SkeletonRows rows={2} />;
  const clean = readiness.blockers.length === 0 && readiness.warnings.length === 0 && readiness.pendingRegularizations === 0;
  return (
    <div className="flex flex-col gap-2">
      {clean ? (
        <p className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" /> All {readiness.eligibleCount} employees are ready for payroll.
        </p>
      ) : (
        <>
          {readiness.blockers.map((g) => (
            <Group key={g.type} group={g} tone="blocker" />
          ))}
          {readiness.warnings.map((g) => (
            <Group key={g.type} group={g} tone="warning" />
          ))}
          {readiness.pendingRegularizations > 0 && (
            <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              {readiness.pendingRegularizations} attendance regularization request
              {readiness.pendingRegularizations === 1 ? ' is' : 's are'} still pending for this month — attendance
              (and pay) may change once they’re decided.
            </p>
          )}
        </>
      )}
      {readiness.blockers.length > 0 && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" /> Employees under a red heading are left out of the run until fixed.
        </p>
      )}
    </div>
  );
}
