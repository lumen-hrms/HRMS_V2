import * as React from 'react';
import { BookText, SlidersHorizontal } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { fmtDate } from '@/pages/leave/shared';
import { leaveApi } from '@/lib/leave/client';
import type { LeaveLedgerEntry, LeaveType } from '@/lib/leave/types';

const SOURCE_LABELS: Record<LeaveLedgerEntry['source'], string> = {
  ACCRUAL: 'Accrual',
  CARRY_FORWARD: 'Carry-forward',
  REQUEST_APPROVED: 'Request approved',
  REQUEST_CANCELLED: 'Request cancelled',
  HR_ADJUSTMENT: 'HR adjustment',
};

const SOURCE_VARIANT: Record<LeaveLedgerEntry['source'], 'default' | 'success' | 'warning' | 'outline'> = {
  ACCRUAL: 'success',
  CARRY_FORWARD: 'outline',
  REQUEST_APPROVED: 'default',
  REQUEST_CANCELLED: 'warning',
  HR_ADJUSTMENT: 'warning',
};

/** Read-only balance-movement audit trail — every credit/debit, from every source. */
export function LedgerTab() {
  const [people, setPeople] = React.useState<{ id: string; name: string }[]>([]);
  const [types, setTypes] = React.useState<LeaveType[]>([]);
  const [employeeId, setEmployeeId] = React.useState('');
  const [leaveTypeCode, setLeaveTypeCode] = React.useState('');
  const [rows, setRows] = React.useState<LeaveLedgerEntry[] | null>(null);

  React.useEffect(() => {
    leaveApi.people().then(setPeople);
    leaveApi.listTypes().then(setTypes);
  }, []);

  const load = React.useCallback(() => {
    setRows(null);
    leaveApi
      .ledger({ employeeId: employeeId || undefined, leaveTypeCode: leaveTypeCode || undefined })
      .then(setRows);
  }, [employeeId, leaveTypeCode]);
  React.useEffect(load, [load]);

  const list = rows ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-end gap-3 p-3">
        <SlidersHorizontal className="mb-2 h-4 w-4 text-muted-foreground" />
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Employee
          <Select className="h-8 w-44" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">All employees</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Leave type
          <Select className="h-8 w-40" value={leaveTypeCode} onChange={(e) => setLeaveTypeCode(e.target.value)}>
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t.id} value={t.code}>
                {t.name}
              </option>
            ))}
          </Select>
        </label>
      </Card>

      <Card className="overflow-hidden">
        {rows == null ? (
          <div className="p-4">
            <SkeletonRows rows={8} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState icon={BookText} title="No ledger entries match these filters" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Employee</TH>
                <TH>Type</TH>
                <TH className="text-right">Delta</TH>
                <TH className="text-right">Balance after</TH>
                <TH>Source</TH>
                <TH>Note</TH>
                <TH>By</TH>
              </TR>
            </THead>
            <TBody>
              {list.map((l) => (
                <TR key={l.id}>
                  <TD className="text-muted-foreground">{fmtDate(l.at)}</TD>
                  <TD className="font-medium text-foreground">{l.employeeName}</TD>
                  <TD>{l.leaveTypeCode}</TD>
                  <TD className={`text-right tabular-nums ${l.delta >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {l.delta >= 0 ? '+' : ''}
                    {l.delta}d
                  </TD>
                  <TD className="text-right tabular-nums">{l.balanceAfter}d</TD>
                  <TD>
                    <Badge variant={SOURCE_VARIANT[l.source]}>{SOURCE_LABELS[l.source]}</Badge>
                  </TD>
                  <TD className="text-muted-foreground">{l.note ?? '—'}</TD>
                  <TD className="text-muted-foreground">{l.actorName}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">{list.length} entries</p>
    </div>
  );
}
