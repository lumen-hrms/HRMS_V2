import * as React from 'react';
import { Download } from 'lucide-react';
import * as payroll from '@/lib/payroll/client';
import type { SalaryStructure, TaxRegime } from '@/lib/payroll/types';
import { useAuth } from '@/context/auth-context';
import { isApiError } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { formatMoney } from '../components/money';

function currentFinancialYear(): string {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/** Last 12 months, most recent first, "YYYY-MM" — there's no "list my
 *  payslips" endpoint, so the period list is built client-side and checked
 *  against `GET /payroll/payslips/:employeeId?period=` on demand per §5.6. */
function last12Periods(): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < 12; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

export function MyPayTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const employeeId = user?.employeeId ?? null;
  const fy = currentFinancialYear();

  const [structure, setStructure] = React.useState<SalaryStructure | 'none' | null>(null);
  const [regime, setRegime] = React.useState<TaxRegime | null>(null);
  const [regimeBusy, setRegimeBusy] = React.useState(false);
  const [checking, setChecking] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!employeeId) return;
    payroll
      .getStructure(employeeId)
      .then(setStructure)
      .catch(() => setStructure('none'));
    payroll
      .getTdsRegime(employeeId, fy)
      .then((r) => setRegime(r.regime))
      .catch(() => setRegime('NEW'));
  }, [employeeId, fy]);

  async function moveRegime(next: TaxRegime) {
    if (!employeeId) return;
    setRegimeBusy(true);
    try {
      await payroll.setTdsRegime(employeeId, fy, next);
      setRegime(next);
      toast({ title: `Tax regime set to ${next} for FY ${fy}`, tone: 'success' });
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Could not change regime', tone: 'error' });
    } finally {
      setRegimeBusy(false);
    }
  }

  async function downloadPayslip(period: string) {
    if (!employeeId) return;
    setChecking(period);
    try {
      const { url } = await payroll.getPayslipUrl(employeeId, period);
      window.open(url, '_blank', 'noopener');
    } catch {
      toast({
        title: 'No payslip for this period',
        description: 'Either it hasn’t been processed yet, or your date of birth is missing on file.',
        tone: 'info',
      });
    } finally {
      setChecking(null);
    }
  }

  if (!employeeId) {
    return <EmptyState title="No employee record linked to this account" />;
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>My salary structure</CardTitle>
          <CardDescription>Read-only — HR/Admin maintains this.</CardDescription>
        </CardHeader>
        <CardContent>
          {structure === null ? (
            <SkeletonRows rows={4} />
          ) : structure === 'none' ? (
            <EmptyState title="Your salary structure hasn't been set up yet" className="py-6" />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Annual CTC</span>
                <span className="font-medium tabular-nums">{formatMoney(structure.ctcAnnual)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Monthly CTC</span>
                <span className="font-medium tabular-nums">{formatMoney(structure.monthlyCtc)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Effective from</span>
                <span>{new Date(structure.effectiveFrom).toLocaleDateString('en-IN')}</span>
              </div>
              <div className="mt-1 flex flex-col gap-1 border-t border-border pt-3">
                {structure.components.map((c) => (
                  <div key={c.id} className="flex justify-between text-sm">
                    <span>{c.name}</span>
                    <span className="tabular-nums">{formatMoney(c.monthlyAmount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tax regime</CardTitle>
          <CardDescription>FY {fy} · defaults to New if you haven't chosen.</CardDescription>
        </CardHeader>
        <CardContent>
          {regime === null ? (
            <SkeletonRows rows={1} />
          ) : (
            <div className="flex items-center gap-3">
              <Badge variant={regime === 'NEW' ? 'success' : 'outline'}>{regime}</Badge>
              <Button
                size="sm"
                variant="outline"
                disabled={regimeBusy}
                onClick={() => moveRegime(regime === 'NEW' ? 'OLD' : 'NEW')}
              >
                Switch to {regime === 'NEW' ? 'Old' : 'New'}
              </Button>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Changing your regime takes effect from your next unprocessed payroll run.
          </p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Payslips</CardTitle>
          <CardDescription>
            Your payslip PDF opens with your date of birth as the password (DDMMYYYY).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Period</TH>
                <TH className="text-right">Download</TH>
              </TR>
            </THead>
            <TBody>
              {last12Periods().map((period) => (
                <TR key={period}>
                  <TD>{period}</TD>
                  <TD className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={checking === period}
                      onClick={() => downloadPayslip(period)}
                    >
                      <Download className="h-3.5 w-3.5" />
                      {checking === period ? 'Checking…' : 'Download'}
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

