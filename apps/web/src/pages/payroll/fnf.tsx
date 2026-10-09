import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import * as payroll from '@/lib/payroll/client';
import type { FullAndFinalSettlement } from '@/lib/payroll/types';
import { useAuth } from '@/context/auth-context';
import { isPayrollAdmin } from '@/lib/roles';
import { isApiError } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';
import { Money } from './components/money';
import { FnfStatusBadge } from './components/status-badge';

export function FullAndFinalPage() {
  const { employeeId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage = isPayrollAdmin(user);
  const isOwn = user?.employeeId === employeeId;

  const [settlement, setSettlement] = React.useState<FullAndFinalSettlement | 'none' | null>(null);
  const [advance, setAdvance] = React.useState(0);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const s = await payroll.getFnf(employeeId);
      setSettlement(s);
      setAdvance(Number(s.advanceRecoveryAmount ?? 0));
    } catch {
      setSettlement('none');
    }
  }, [employeeId]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function generate() {
    setBusy('generate');
    try {
      await payroll.generateFnf(employeeId);
      toast({ title: 'Full & Final settlement generated', tone: 'success' });
      load();
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Could not generate settlement', tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function saveAdvance() {
    setBusy('advance');
    try {
      const s = await payroll.updateFnfAdvance(employeeId, advance);
      setSettlement(s);
      toast({ title: 'Advance recovery updated', tone: 'success' });
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Save failed', tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (!confirm('Approve this settlement? This is Full & Final\'s own one-approval step.')) return;
    setBusy('approve');
    try {
      await payroll.approveFnf(employeeId);
      toast({ title: 'Settlement approved', tone: 'success' });
      load();
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Approval failed', tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function markPaid() {
    if (!confirm('Mark this settlement as paid? This is irreversible.')) return;
    setBusy('paid');
    try {
      await payroll.markFnfPaid(employeeId);
      toast({ title: 'Settlement marked paid', tone: 'success' });
      load();
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Could not mark paid', tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  if (!canManage && !isOwn) {
    return <EmptyState title="Not authorized to view this settlement" />;
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Full & Final settlement"
        description={employeeId}
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate('/payroll')}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        }
      />

      {settlement === null ? (
        <SkeletonRows rows={6} />
      ) : settlement === 'none' ? (
        <Card className="p-6">
          <EmptyState
            title="No Full & Final settlement yet"
            description={
              canManage
                ? 'Generate one for this employee — requires lastWorkingDate, dateOfJoining and an active salary structure on file.'
                : 'Nothing has been generated for you yet.'
            }
            action={
              canManage ? (
                <Button disabled={busy !== null} onClick={generate}>
                  {busy === 'generate' ? 'Generating…' : 'Generate settlement'}
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Settlement
                <FnfStatusBadge status={settlement.status} />
              </CardTitle>
              <CardDescription>
                Separation date {new Date(settlement.separationDate).toLocaleDateString('en-IN')}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {settlement.unpaidSalaryAmount !== undefined ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Line
                    label={`Unpaid salary (${settlement.unpaidSalaryDays} day${settlement.unpaidSalaryDays === 1 ? '' : 's'})`}
                    value={settlement.unpaidSalaryAmount}
                  />
                  <Line
                    label={`Leave encashment (${settlement.leaveEncashmentDays} day${Number(settlement.leaveEncashmentDays) === 1 ? '' : 's'})`}
                    value={settlement.leaveEncashmentAmount ?? 0}
                  />
                  <Line
                    label={`Gratuity (${settlement.gratuityYearsOfService} year${settlement.gratuityYearsOfService === 1 ? '' : 's'} of service)`}
                    value={settlement.gratuityAmount ?? 0}
                  />
                  <Line label="Advance recovery" value={-Number(settlement.advanceRecoveryAmount ?? 0)} />
                </div>

                <div className="flex items-center justify-between border-t border-border pt-4">
                  <span className="text-sm font-semibold">Net settlement</span>
                  <Money value={settlement.netSettlement} className="text-lg font-semibold" />
                </div>

                {canManage && settlement.status === 'DRAFT' && (
                  <div className="flex items-end gap-2 border-t border-border pt-4">
                    <Field label="Advance recovery amount" className="max-w-xs">
                      <Input
                        type="number"
                        value={advance}
                        onChange={(e) => setAdvance(Number(e.target.value))}
                      />
                    </Field>
                    <Button variant="outline" disabled={busy !== null} onClick={saveAdvance}>
                      {busy === 'advance' ? 'Saving…' : 'Update advance'}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Auditor view — status and dates only, no amounts (decision 9).
              </p>
            )}

            {canManage && (
              <div className="flex gap-2 border-t border-border pt-4">
                {settlement.status === 'DRAFT' && (
                  <Button disabled={busy !== null} onClick={approve}>
                    {busy === 'approve' ? 'Approving…' : 'Approve'}
                  </Button>
                )}
                {settlement.status === 'APPROVED' && (
                  <Button disabled={busy !== null} onClick={markPaid}>
                    {busy === 'paid' ? 'Marking paid…' : 'Mark paid'}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Money value={value} className="font-medium" />
    </div>
  );
}
