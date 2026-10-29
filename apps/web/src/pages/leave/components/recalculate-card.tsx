import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { api, isApiError } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { leaveApi } from '@/lib/leave/client';
import type { PolicyRecalcResult } from '@/lib/leave/types';

/**
 * Leave › Settings › "Recalculate policy credits" (Company Admin): reverses
 * this leave year's policy credits and re-applies them — with a corrected
 * go-live date if one is given. Always previewed first; the preview is the
 * exact result Apply produces (`LeavePolicyRecalcService`).
 */
export function RecalculateCard() {
  const { toast } = useToast();
  const [goLiveDate, setGoLiveDate] = React.useState('');
  const [savedGoLive, setSavedGoLive] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<PolicyRecalcResult | null>(null);
  const [busy, setBusy] = React.useState<null | 'preview' | 'apply'>(null);

  React.useEffect(() => {
    api
      .get<{ goLiveDate: string | null }>('/tenant-config/company-profile')
      .then((r) => {
        setSavedGoLive(r.goLiveDate);
        setGoLiveDate(r.goLiveDate ?? '');
      })
      .catch(() => undefined);
  }, []);

  const input = () => ({ goLiveDate: goLiveDate && goLiveDate !== savedGoLive ? goLiveDate : undefined });

  async function run(dryRun: boolean) {
    setBusy(dryRun ? 'preview' : 'apply');
    try {
      const result = await leaveApi.recalculatePolicy({ ...input(), dryRun });
      if (dryRun) {
        setPreview(result);
      } else {
        setPreview(null);
        setSavedGoLive(result.goLiveDate);
        toast({ title: 'Leave credits recalculated', description: `${result.changes.length} balances updated.` });
      }
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Recalculation failed', tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="flex max-w-3xl flex-col gap-4 p-5">
      <div>
        <h2 className="text-sm font-semibold">Recalculate policy credits</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          For when the go-live date was wrong or credits were made under older rules. Reverses this leave year’s
          policy credits and applies them again. Opening balances, carry-forward, manual adjustments, comp-off and
          event-based leave aren’t touched, and leave already taken stays taken.
        </p>
      </div>
      <Field
        label="Go-live date"
        hint={savedGoLive ? `Currently ${savedGoLive}. Change it, or keep it to just re-apply today’s rules.` : undefined}
        className="max-w-xs"
      >
        <Input
          type="date"
          value={goLiveDate}
          onChange={(e) => {
            setGoLiveDate(e.target.value);
            setPreview(null);
          }}
        />
      </Field>
      <div className="flex gap-2">
        <Button variant="outline" disabled={busy !== null} onClick={() => void run(true)}>
          <RefreshCw className="h-3.5 w-3.5" /> {busy === 'preview' ? 'Working it out…' : 'Preview'}
        </Button>
        {preview && (
          <Button disabled={busy !== null || preview.changes.length === 0} onClick={() => void run(false)}>
            {busy === 'apply' ? 'Applying…' : `Apply ${preview.changes.length} change${preview.changes.length === 1 ? '' : 's'}`}
          </Button>
        )}
      </div>
      {preview && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Leave year {preview.leaveYear}
            {preview.goLiveDate ? ` · go-live ${preview.goLiveDate}` : ''} ·{' '}
            {preview.changes.length === 0 ? 'nothing would change.' : `${preview.changes.length} balances would change. Nothing is saved until you apply.`}
          </p>
          {preview.negativeBalances > 0 && (
            <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
              {preview.negativeBalances} balance{preview.negativeBalances === 1 ? '' : 's'} would go below zero because the
              leave was already taken — they’ll show negative until more is credited or you adjust them.
            </p>
          )}
          {preview.changes.length > 0 && (
            <div className="max-h-80 overflow-auto rounded-md border border-border">
              <Table>
                <THead>
                  <TR>
                    <TH>Employee</TH>
                    <TH>Type</TH>
                    <TH className="text-right">Available now</TH>
                    <TH className="text-right">After</TH>
                  </TR>
                </THead>
                <TBody>
                  {preview.changes.map((c) => (
                    <TR key={`${c.employeeId}-${c.leaveTypeCode}`}>
                      <TD>
                        {c.employeeName} <span className="font-mono text-xs text-muted-foreground">{c.employeeCode}</span>
                      </TD>
                      <TD className="font-mono text-xs">{c.leaveTypeCode}</TD>
                      <TD className="text-right tabular-nums">{c.before}</TD>
                      <TD className={c.after < 0 ? 'text-right tabular-nums text-destructive' : 'text-right tabular-nums'}>
                        {c.after}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
