import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import * as payroll from '@/lib/payroll/client';
import { isApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { SkeletonRows } from '@/components/ui/skeleton';

const STATES = [
  'ANDHRA_PRADESH', 'ARUNACHAL_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GOA', 'GUJARAT',
  'HARYANA', 'HIMACHAL_PRADESH', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA_PRADESH',
  'MAHARASHTRA', 'MANIPUR', 'MEGHALAYA', 'MIZORAM', 'NAGALAND', 'ODISHA', 'PUNJAB', 'RAJASTHAN',
  'SIKKIM', 'TAMIL_NADU', 'TELANGANA', 'TRIPURA', 'UTTAR_PRADESH', 'UTTARAKHAND', 'WEST_BENGAL',
  'ANDAMAN_AND_NICOBAR_ISLANDS', 'CHANDIGARH', 'DADRA_AND_NAGAR_HAVELI_AND_DAMAN_AND_DIU', 'DELHI',
  'JAMMU_AND_KASHMIR', 'LADAKH', 'LAKSHADWEEP', 'PUDUCHERRY',
];

interface Row {
  grossFrom: number;
  grossTo: number | null;
  monthlyAmount: number;
  februaryAmount: number | null;
}

export function PtSlabEditor({ readOnly }: { readOnly: boolean }) {
  const { toast } = useToast();
  const [state, setState] = React.useState('KARNATAKA');
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    setRows(null);
    payroll.listPtSlabs(state).then((slabs) =>
      setRows(
        slabs.map((s) => ({
          grossFrom: Number(s.grossFrom),
          grossTo: s.grossTo == null ? null : Number(s.grossTo),
          monthlyAmount: Number(s.monthlyAmount),
          februaryAmount: s.februaryAmount == null ? null : Number(s.februaryAmount),
        })),
      ),
    );
  }, [state]);
  React.useEffect(load, [load]);

  async function save() {
    if (!rows) return;
    setBusy(true);
    try {
      await payroll.replacePtSlabs(state, rows);
      toast({ title: `Slabs saved for ${state}`, tone: 'success' });
      load();
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Save failed', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Select value={state} onChange={(e) => setState(e.target.value)} className="w-56">
        {STATES.map((s) => (
          <option key={s} value={s}>
            {s.replace(/_/g, ' ')}
          </option>
        ))}
      </Select>

      {rows === null ? (
        <SkeletonRows rows={3} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No PT deducted for this state.</p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Gross from</TH>
              <TH>Gross to</TH>
              <TH>Monthly</TH>
              <TH>February</TH>
              <TH></TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r, i) => (
              <TR key={i}>
                <TD>
                  <Input
                    type="number"
                    value={r.grossFrom}
                    disabled={readOnly}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs!.map((x, idx) => (idx === i ? { ...x, grossFrom: Number(e.target.value) } : x)),
                      )
                    }
                    className="w-28"
                  />
                </TD>
                <TD>
                  <Input
                    type="number"
                    placeholder="open-ended"
                    value={r.grossTo ?? ''}
                    disabled={readOnly}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs!.map((x, idx) =>
                          idx === i
                            ? { ...x, grossTo: e.target.value === '' ? null : Number(e.target.value) }
                            : x,
                        ),
                      )
                    }
                    className="w-28"
                  />
                </TD>
                <TD>
                  <Input
                    type="number"
                    value={r.monthlyAmount}
                    disabled={readOnly}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs!.map((x, idx) => (idx === i ? { ...x, monthlyAmount: Number(e.target.value) } : x)),
                      )
                    }
                    className="w-24"
                  />
                </TD>
                <TD>
                  <Input
                    type="number"
                    placeholder="same as monthly"
                    value={r.februaryAmount ?? ''}
                    disabled={readOnly}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs!.map((x, idx) =>
                          idx === i
                            ? {
                                ...x,
                                februaryAmount: e.target.value === '' ? null : Number(e.target.value),
                              }
                            : x,
                        ),
                      )
                    }
                    className="w-28"
                  />
                </TD>
                <TD>
                  {!readOnly && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRows((rs) => rs!.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {!readOnly && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setRows((rs) => [...(rs ?? []), { grossFrom: 0, grossTo: null, monthlyAmount: 0, februaryAmount: null }])
            }
          >
            <Plus className="h-4 w-4" /> Add slab
          </Button>
          <Button size="sm" disabled={busy || !rows?.length} onClick={save}>
            {busy ? 'Saving…' : 'Save slabs'}
          </Button>
        </div>
      )}
    </div>
  );
}
