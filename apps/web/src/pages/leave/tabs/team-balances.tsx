import * as React from 'react';
import { Users } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { availableDays, type LeaveType, type TeamBalanceRow } from '@/lib/leave/types';
import { leaveApi } from '@/lib/leave/client';
import { MOCK_CURRENT_YEAR } from '@/lib/leave/fixtures';
import { useLeaveCtx } from '@/pages/leave/use-leave-ctx';

/**
 * Team leave balances as a matrix: one row per report, one column per leave
 * type, cell = days available. Expand a row for the accrued/carried/used/
 * pending breakdown. Low balances (≤ 2 days) are flagged.
 */
export function TeamBalancesTab() {
  const ctx = useLeaveCtx();
  const [year, setYear] = React.useState(MOCK_CURRENT_YEAR);
  const [types, setTypes] = React.useState<LeaveType[]>([]);
  const [rows, setRows] = React.useState<TeamBalanceRow[] | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  React.useEffect(() => {
    leaveApi.listTypes().then(setTypes);
  }, []);

  React.useEffect(() => {
    if (!ctx) return;
    setRows(null);
    leaveApi.teamBalances(ctx, year).then(setRows);
  }, [ctx, year]);

  if (!ctx) {
    return <p className="text-sm text-muted-foreground">This account has no linked employee record.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setYear((y) => y - 1)}>
          ‹ {year - 1}
        </Button>
        <span className="text-sm font-semibold">{year}</span>
        <Button variant="outline" size="sm" onClick={() => setYear((y) => y + 1)}>
          {year + 1} ›
        </Button>
      </div>

      <Card className="overflow-hidden">
        {rows == null ? (
          <div className="p-4">
            <SkeletonRows rows={5} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Users} title="No reports" description="Nobody currently reports to you." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                {types.map((t) => (
                  <TH key={t.id} className="text-right">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: t.colorToken }}
                      />
                      {t.code}
                    </span>
                  </TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => {
                const isOpen = expanded === row.employeeId;
                return (
                  <React.Fragment key={row.employeeId}>
                    <TR
                      className="cursor-pointer hover:bg-accent"
                      onClick={() => setExpanded(isOpen ? null : row.employeeId)}
                    >
                      <TD>
                        <div className="font-medium">{row.employeeName}</div>
                        <div className="text-xs text-muted-foreground">{row.department ?? '—'}</div>
                      </TD>
                      {types.map((t) => {
                        const bal = row.balances.find((b) => b.leaveTypeId === t.id);
                        const avail = bal ? availableDays(bal) : 0;
                        return (
                          <TD key={t.id} className="text-right tabular-nums">
                            <span
                              className={cn(
                                'font-medium',
                                avail <= 2 && 'text-warning',
                                avail < 0 && 'text-destructive',
                              )}
                            >
                              {avail % 1 === 0 ? avail : avail.toFixed(1)}
                            </span>
                          </TD>
                        );
                      })}
                    </TR>
                    {isOpen && (
                      <TR className="bg-muted/40">
                        <TD colSpan={types.length + 1}>
                          <div className="grid grid-cols-2 gap-3 py-1 sm:grid-cols-3 lg:grid-cols-4">
                            {row.balances.map((b) => (
                              <div key={b.leaveTypeId} className="rounded-md border border-border bg-card p-2 text-xs">
                                <div className="mb-1 font-medium">{b.leaveType.name}</div>
                                <dl className="grid grid-cols-2 gap-x-2 text-muted-foreground">
                                  <dt>Accrued</dt>
                                  <dd className="text-right text-foreground">{b.accrued}</dd>
                                  <dt>Carried</dt>
                                  <dd className="text-right text-foreground">{b.carriedForward}</dd>
                                  <dt>Used</dt>
                                  <dd className="text-right text-foreground">{b.used}</dd>
                                  <dt>Pending</dt>
                                  <dd className="text-right text-foreground">{b.pending}</dd>
                                </dl>
                              </div>
                            ))}
                          </div>
                        </TD>
                      </TR>
                    )}
                  </React.Fragment>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">
        Cell = days available (accrued + carried − used − pending). Amber ≤ 2 days.
        Click a row for the breakdown.
      </p>
    </div>
  );
}
