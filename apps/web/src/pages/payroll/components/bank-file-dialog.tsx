import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, ShieldAlert, TriangleAlert } from 'lucide-react';
import * as payroll from '@/lib/payroll/client';
import type { BankFilePreview, BankFormatOption, PaymentMode } from '@/lib/payroll/types';
import { isApiError } from '@/lib/api';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { SkeletonRows } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Money } from './money';
import { StatTile } from './stat-tile';
import { periodLabel } from './format';

const MODE_LABEL: Record<PaymentMode, string> = {
  OWN_BANK: 'Same bank',
  NEFT: 'NEFT',
  IMPS: 'IMPS',
  RTGS: 'RTGS',
};

/** Check what's going into the bank file, then download it in the chosen bank's layout. */
export function BankFileDialog({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { toast } = useToast();
  const [, setParams] = useSearchParams();
  const [formats, setFormats] = React.useState<BankFormatOption[] | null>(null);
  const [formatId, setFormatId] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<BankFilePreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [downloading, setDownloading] = React.useState(false);

  // Formats + the company's bank first, so the right layout is pre-selected.
  React.useEffect(() => {
    Promise.all([payroll.listBankFormats(), payroll.getBankConfig()])
      .then(([f, cfg]) => {
        setFormats(f);
        const mine = f.find((x) => x.bankCode && x.bankCode === cfg.config?.bankCode && x.available);
        setFormatId(mine?.id ?? 'CSV');
      })
      .catch((err) => setError(isApiError(err) ? err.message : 'Could not load bank formats'));
  }, []);

  React.useEffect(() => {
    if (!formatId) return;
    let stale = false;
    setPreview(null);
    setError(null);
    payroll
      .previewBankFile(runId, formatId)
      .then((p) => !stale && setPreview(p))
      .catch((err) => !stale && setError(isApiError(err) ? err.message : 'Could not check the bank file'));
    return () => {
      stale = true;
    };
  }, [runId, formatId]);

  async function download() {
    if (!formatId) return;
    setDownloading(true);
    try {
      const f = await payroll.getBankFile(runId, formatId);
      const url = URL.createObjectURL(new Blob([f.content], { type: f.mimeType }));
      const a = document.createElement('a');
      a.href = url;
      a.download = f.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast({
        title: `Downloaded ${f.filename}`,
        description: f.skippedEmployeeCount > 0 ? `${f.skippedEmployeeCount} employee(s) were left out.` : undefined,
        tone: 'success',
      });
      onClose();
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Could not download the bank file', tone: 'error' });
    } finally {
      setDownloading(false);
    }
  }

  const goTo = (params: Record<string, string>) => {
    setParams(params);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader title="Bank file" onClose={onClose} />
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
          <Field label="Bank layout" hint="Pre-selected from your company’s bank (Settings → Bank).">
            <Select value={formatId ?? ''} onChange={(e) => setFormatId(e.target.value)} disabled={!formats}>
              {(formats ?? []).map((f) => (
                <option key={f.id} value={f.id} disabled={!f.available}>
                  {f.label}
                  {f.available ? '' : ' — layout coming soon'}
                </option>
              ))}
            </Select>
          </Field>

          {error ? (
            <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          ) : !preview ? (
            <SkeletonRows rows={4} />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <StatTile label="In the file" value={preview.counts.included} caption={`of ${preview.counts.paid} paid`} />
                <StatTile label="Total to pay" value={<Money value={preview.total} />} caption={periodLabel(preview.period)} />
                <StatTile label="Left out" value={preview.counts.leftOut} caption={preview.counts.leftOut ? 'see below' : 'none'} />
              </div>

              <div className="rounded-xl border border-border/60 bg-secondary/40 px-4 py-3 text-sm">
                <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Paying from</p>
                {preview.company ? (
                  <p>
                    <strong>{preview.company.bankCode}</strong> · {preview.company.accountMasked} · {preview.company.ifsc}
                  </p>
                ) : (
                  <p className="flex flex-wrap items-center gap-2 text-warning">
                    Company bank isn’t set up.
                    <Button size="sm" variant="outline" onClick={() => goTo({ tab: 'settings' })}>
                      Set it up
                    </Button>
                  </p>
                )}
                {preview.byMode.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                    {preview.byMode.map((m) => (
                      <li key={m.mode}>
                        {MODE_LABEL[m.mode]}: {m.count} · <Money value={m.total} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {preview.warnings.map((w) => (
                <p key={w} className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
                </p>
              ))}

              {preview.leftOut.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">Left out of the file ({preview.leftOut.length})</p>
                    <Button size="sm" variant="outline" onClick={() => goTo({ tab: 'people', filter: 'NO_BANK' })}>
                      Fix in People &amp; Pay
                    </Button>
                  </div>
                  <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-xs">
                    {preview.leftOut.map((l) => (
                      <li key={l.employeeId} className="rounded-xl border border-border/60 px-3 py-1.5">
                        <span className="font-medium">{l.name}</span> <span className="text-muted-foreground">({l.employeeCode})</span>
                        <span className="text-destructive"> — {l.problems.join('; ')}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                The file contains full account numbers in plain text. Upload it to your bank and delete it afterwards. Each
                download is logged.
              </p>
            </>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button disabled={!preview || !preview.format.available || preview.counts.included === 0 || downloading} onClick={download}>
            <Download className="h-4 w-4" /> {downloading ? 'Preparing…' : 'Download file'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
