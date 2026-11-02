import * as React from 'react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SkeletonRows } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { isApiError } from '@/lib/api';
import * as payroll from '@/lib/payroll/client';
import type { LineItemDetail } from '@/lib/payroll/types';
import { Money } from './money';
import { AdjustmentsDialog } from './adjustments-dialog';
import { Delta } from './stat-tile';
import { pctChange } from './format';

function Line({ label, value, strong, negative }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean; negative?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-1 text-sm ${strong ? 'border-t border-border pt-2 font-semibold' : ''}`}>
      <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
      <span className={`tabular-nums ${negative ? 'text-destructive' : ''}`}>{value}</span>
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="flex flex-col">
    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
    {children}
  </section>
);

/** One employee's pay, line by line, taken from the run's stored calculation. */
export function EmployeeDrawer({
  runId,
  period,
  employeeId,
  canAdjust,
  locked,
  onClose,
  onChanged,
}: {
  runId: string;
  period: string;
  employeeId: string | null;
  canAdjust: boolean;
  locked: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [detail, setDetail] = React.useState<LineItemDetail | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [adjustOpen, setAdjustOpen] = React.useState(false);

  const load = React.useCallback(() => {
    if (!employeeId) return;
    setFailed(false);
    payroll
      .getLineItemDetail(runId, employeeId)
      .then(setDetail)
      .catch(() => setFailed(true));
  }, [runId, employeeId]);

  React.useEffect(() => {
    setDetail(null);
    load();
  }, [load]);

  async function openPayslip() {
    if (!employeeId) return;
    try {
      const { url } = await payroll.getPayslipUrl(employeeId, period);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'No payslip for this employee/period', tone: 'info' });
    }
  }

  const snap = detail?.calculationSnapshot;
  const earnings = snap?.earnings ?? [];
  const adjustments = detail?.adHocAdjustments ?? [];

  return (
    <>
      <Sheet
        open={!!employeeId}
        onOpenChange={(o) => !o && onClose()}
        title={detail?.employee?.name ?? 'Employee'}
        description={
          detail?.employee
            ? `${detail.employee.employeeCode} · ${detail.employee.designation ?? 'No designation'}${detail.employee.department ? ` · ${detail.employee.department}` : ''}`
            : undefined
        }
        className="max-w-lg"
        footer={
          detail && (
            <div className="flex justify-end gap-2">
              {canAdjust && !locked && (
                <Button variant="outline" onClick={() => setAdjustOpen(true)}>
                  Adjust pay
                </Button>
              )}
              {locked && <Button onClick={openPayslip}>Open payslip</Button>}
            </div>
          )
        }
      >
        {failed ? (
          <div className="flex flex-col items-start gap-2 text-sm">
            <p className="text-destructive">Couldn’t load this employee’s breakdown.</p>
            <Button size="sm" variant="outline" onClick={load}>
              Retry
            </Button>
          </div>
        ) : !detail ? (
          <SkeletonRows rows={8} />
        ) : (
          <div className="flex flex-col gap-5">
            {detail.exceptions.length > 0 && (
              <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                {detail.exceptions.map((e, i) => (
                  <div key={i}>
                    <strong>{e.type}</strong> — {e.detail}
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 text-center">
              <Badge variant="outline" className="justify-center py-1">Working {detail.workingDays}</Badge>
              <Badge variant="outline" className="justify-center py-1">Paid {detail.payableDays}</Badge>
              <Badge variant={detail.lopDays > 0 ? 'warning' : 'outline'} className="justify-center py-1">
                LOP {detail.lopDays}
              </Badge>
            </div>

            <Section title="Earnings">
              {earnings.map((e) => (
                <Line
                  key={e.code}
                  label={
                    <>
                      {e.code}
                      {e.proratedAmount !== e.fullMonthlyAmount && (
                        <span className="ml-1 text-xs">(full <Money value={e.fullMonthlyAmount} />)</span>
                      )}
                    </>
                  }
                  value={<Money value={e.proratedAmount} />}
                />
              ))}
              {!!snap?.overtimePay && <Line label="Overtime" value={<Money value={snap.overtimePay} />} />}
              <Line label="Gross earnings" strong value={<Money value={detail.grossEarnings} />} />
            </Section>

            <Section title="Deductions">
              <Line label="EPF (employee)" value={<Money value={detail.epfEmployee} />} />
              <Line label="ESI (employee)" value={<Money value={detail.esiEmployee} />} />
              <Line label="Professional Tax" value={<Money value={detail.professionalTax} />} />
              <Line label="TDS" value={<Money value={detail.tdsDeducted} />} />
            </Section>

            {adjustments.length > 0 && (
              <Section title="Adjustments">
                {adjustments.map((a, i) => (
                  <Line
                    key={i}
                    label={`${a.type}${a.note ? ` — ${a.note}` : ''}`}
                    value={<Money value={a.amount} />}
                  />
                ))}
              </Section>
            )}

            <Section title="Net pay">
              <Line label="Take-home" strong value={<Money value={detail.netPay} className="text-base" />} />
              <p className="mt-1 text-xs text-muted-foreground">
                <Delta pct={pctChange(detail.netPay, detail.previousNet)} />
              </p>
            </Section>

            <Section title="Employer contributions (not in take-home)">
              <Line label="EPF (employer)" value={<Money value={detail.epfEmployer} />} />
              <Line label="ESI (employer)" value={<Money value={detail.esiEmployer} />} />
            </Section>
          </div>
        )}
      </Sheet>
      <AdjustmentsDialog
        runId={runId}
        employeeId={adjustOpen ? employeeId : null}
        initial={adjustments}
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        onSaved={() => {
          load();
          onChanged();
        }}
      />
    </>
  );
}
