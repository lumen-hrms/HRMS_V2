import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import * as payroll from '@/lib/payroll/client';
import type { TaxRegime } from '@/lib/payroll/types';
import { isApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { SkeletonRows } from '@/components/ui/skeleton';

function currentFinancialYear(): string {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

interface SlabRow {
  incomeFrom: number;
  incomeTo: number | null;
  ratePercent: number;
}
interface ConfigForm {
  standardDeduction: number;
  cessPercent: number;
  rebateThreshold: number;
  rebateMaxAmount: number;
}

export function TaxSlabEditor({ readOnly }: { readOnly: boolean }) {
  const { toast } = useToast();
  const [fy, setFy] = React.useState(currentFinancialYear());
  const [regime, setRegime] = React.useState<TaxRegime>('NEW');
  const [slabs, setSlabs] = React.useState<SlabRow[] | null>(null);
  const [config, setConfig] = React.useState<ConfigForm | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    setSlabs(null);
    setConfig(null);
    payroll.getTaxConfig(fy).then((tc) => {
      const r = tc[regime];
      setSlabs(
        r.slabs.map((s) => ({
          incomeFrom: Number(s.incomeFrom),
          incomeTo: s.incomeTo == null ? null : Number(s.incomeTo),
          ratePercent: Number(s.ratePercent),
        })),
      );
      setConfig({
        standardDeduction: Number(r.config.standardDeduction),
        cessPercent: Number(r.config.cessPercent),
        rebateThreshold: Number(r.config.rebateThreshold),
        rebateMaxAmount: Number(r.config.rebateMaxAmount),
      });
    });
  }, [fy, regime]);
  React.useEffect(load, [load]);

  async function saveSlabs() {
    if (!slabs) return;
    setBusy(true);
    try {
      await payroll.replaceTaxSlabs(regime, fy, slabs);
      toast({ title: `${regime} slabs saved for FY ${fy}`, tone: 'success' });
      load();
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Save failed', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function saveConfig() {
    if (!config) return;
    setBusy(true);
    try {
      await payroll.updateTaxRegimeConfig(regime, fy, config);
      toast({ title: `${regime} config saved for FY ${fy}`, tone: 'success' });
      load();
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Save failed', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Field label="Financial year" className="w-40">
          <Input value={fy} onChange={(e) => setFy(e.target.value)} placeholder="YYYY-YY" />
        </Field>
      </div>

      <Tabs value={regime} onValueChange={(v) => setRegime(v as TaxRegime)}>
        <TabsList>
          <TabsTrigger value="NEW">New regime</TabsTrigger>
          <TabsTrigger value="OLD">Old regime</TabsTrigger>
        </TabsList>
        <TabsContent value={regime}>
          {slabs === null || config === null ? (
            <SkeletonRows rows={4} />
          ) : (
            <div className="flex flex-col gap-4">
              <Table>
                <THead>
                  <TR>
                    <TH>Income from</TH>
                    <TH>Income to</TH>
                    <TH>Rate %</TH>
                    <TH></TH>
                  </TR>
                </THead>
                <TBody>
                  {slabs.map((s, i) => (
                    <TR key={i}>
                      <TD>
                        <Input
                          type="number"
                          value={s.incomeFrom}
                          disabled={readOnly}
                          onChange={(e) =>
                            setSlabs((rs) =>
                              rs!.map((x, idx) => (idx === i ? { ...x, incomeFrom: Number(e.target.value) } : x)),
                            )
                          }
                          className="w-32"
                        />
                      </TD>
                      <TD>
                        <Input
                          type="number"
                          placeholder="open-ended"
                          value={s.incomeTo ?? ''}
                          disabled={readOnly}
                          onChange={(e) =>
                            setSlabs((rs) =>
                              rs!.map((x, idx) =>
                                idx === i
                                  ? { ...x, incomeTo: e.target.value === '' ? null : Number(e.target.value) }
                                  : x,
                              ),
                            )
                          }
                          className="w-32"
                        />
                      </TD>
                      <TD>
                        <Input
                          type="number"
                          value={s.ratePercent}
                          disabled={readOnly}
                          onChange={(e) =>
                            setSlabs((rs) =>
                              rs!.map((x, idx) => (idx === i ? { ...x, ratePercent: Number(e.target.value) } : x)),
                            )
                          }
                          className="w-24"
                        />
                      </TD>
                      <TD>
                        {!readOnly && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSlabs((rs) => rs!.filter((_, idx) => idx !== i))}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              {!readOnly && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSlabs((rs) => [...(rs ?? []), { incomeFrom: 0, incomeTo: null, ratePercent: 0 }])
                    }
                  >
                    <Plus className="h-4 w-4" /> Add slab
                  </Button>
                  <Button size="sm" disabled={busy} onClick={saveSlabs}>
                    {busy ? 'Saving…' : 'Save slabs'}
                  </Button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 border-t border-border pt-4 md:grid-cols-4">
                <Field label="Standard deduction">
                  <Input
                    type="number"
                    value={config.standardDeduction}
                    disabled={readOnly}
                    onChange={(e) => setConfig((c) => (c ? { ...c, standardDeduction: Number(e.target.value) } : c))}
                  />
                </Field>
                <Field label="Cess %">
                  <Input
                    type="number"
                    value={config.cessPercent}
                    disabled={readOnly}
                    onChange={(e) => setConfig((c) => (c ? { ...c, cessPercent: Number(e.target.value) } : c))}
                  />
                </Field>
                <Field label="87A rebate threshold">
                  <Input
                    type="number"
                    value={config.rebateThreshold}
                    disabled={readOnly}
                    onChange={(e) => setConfig((c) => (c ? { ...c, rebateThreshold: Number(e.target.value) } : c))}
                  />
                </Field>
                <Field label="87A rebate max">
                  <Input
                    type="number"
                    value={config.rebateMaxAmount}
                    disabled={readOnly}
                    onChange={(e) => setConfig((c) => (c ? { ...c, rebateMaxAmount: Number(e.target.value) } : c))}
                  />
                </Field>
              </div>
              {!readOnly && (
                <Button size="sm" className="self-start" disabled={busy} onClick={saveConfig}>
                  {busy ? 'Saving…' : 'Save config'}
                </Button>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
