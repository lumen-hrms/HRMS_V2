import * as React from 'react';
import { Download, Search, SlidersHorizontal } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import {
  LeaveStatusBadge,
  LeaveTypeChip,
  LopBadge,
  dayLabel,
  fmtDate,
  fmtRange,
} from '@/pages/leave/shared';
import { RequestDetailSheet } from '@/pages/leave/components/request-detail-sheet';
import { leaveApi } from '@/lib/leave/client';
import { STATUS_LABELS, type AllRequestsFilter, type LeaveRequest, type LeaveRequestStatus, type LeaveType } from '@/lib/leave/types';
import { useLeaveCtx } from '@/pages/leave/use-leave-ctx';

/**
 * Org-wide leave register. HR / Company Admin get it as an operational queue
 * (can open a pending L2 item and decide); Auditor gets the same view
 * read-only (`readOnly`). Filters: status, type, department, date range, free
 * text. CSV export is client-side over the current result set.
 */
export function AllRequestsTab({
  readOnly = false,
  refreshKey,
  onDecided,
}: {
  readOnly?: boolean;
  refreshKey: number;
  onDecided: () => void;
}) {
  const ctx = useLeaveCtx();
  const { toast } = useToast();
  const [rows, setRows] = React.useState<LeaveRequest[] | null>(null);
  const [types, setTypes] = React.useState<LeaveType[]>([]);
  const [departments, setDepartments] = React.useState<string[]>([]);
  const [filter, setFilter] = React.useState<AllRequestsFilter>({ status: 'ALL' });
  const [selected, setSelected] = React.useState<LeaveRequest | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    leaveApi.listTypes(true).then(setTypes);
    leaveApi.people().then((p) => setDepartments([...new Set(p.map((x) => x.department))].sort()));
  }, []);

  const load = React.useCallback(() => {
    setRows(null);
    leaveApi.allRequests(filter).then(setRows);
  }, [filter]);

  React.useEffect(load, [load, refreshKey]);

  async function decide(id: string, action: 'approve' | 'reject', comment?: string) {
    if (!ctx) return;
    setBusy(true);
    try {
      await leaveApi.decide(id, action, ctx, comment);
      toast({ title: action === 'approve' ? 'Request approved' : 'Request rejected', tone: action === 'approve' ? 'success' : 'info' });
      onDecided();
      load();
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const list = rows ?? [];
    const header = ['Employee', 'Department', 'Type', 'Start', 'End', 'Days', 'LOP', 'Status', 'Requested'];
    const lines = list.map((r) =>
      [
        `${r.employee.firstName} ${r.employee.lastName}`.trim(),
        r.employee.department ?? '',
        r.leaveType.code,
        r.startDate,
        r.endDate,
        r.days,
        r.isLop ? 'Y' : 'N',
        STATUS_LABELS[r.status],
        r.createdAt.slice(0, 10),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leave-requests-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const list = rows ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-end gap-3 p-3">
        <SlidersHorizontal className="mb-2 h-4 w-4 text-muted-foreground" />
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Status
          <Select
            className="h-8 w-40"
            value={filter.status ?? 'ALL'}
            onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value as LeaveRequestStatus | 'ALL' }))}
          >
            <option value="ALL">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Type
          <Select
            className="h-8 w-36"
            value={filter.leaveTypeId ?? ''}
            onChange={(e) => setFilter((f) => ({ ...f, leaveTypeId: e.target.value || undefined }))}
          >
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Department
          <Select
            className="h-8 w-40"
            value={filter.department ?? ''}
            onChange={(e) => setFilter((f) => ({ ...f, department: e.target.value || undefined }))}
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          From
          <Input
            type="date"
            className="h-8 w-36"
            value={filter.from ?? ''}
            onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value || undefined }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          To
          <Input
            type="date"
            className="h-8 w-36"
            value={filter.to ?? ''}
            onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value || undefined }))}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Search
          <span className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-7"
              placeholder="Employee or reason…"
              value={filter.q ?? ''}
              onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value || undefined }))}
            />
          </span>
        </label>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setFilter({ status: 'ALL' })}>
            Clear
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={list.length === 0}>
            <Download className="h-4 w-4" /> CSV
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {rows == null ? (
          <div className="p-4">
            <SkeletonRows rows={8} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState icon={Search} title="No requests match these filters" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Type</TH>
                <TH>Dates</TH>
                <TH className="text-right">Days</TH>
                <TH>Requested</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {list.map((r) => (
                <TR
                  key={r.id}
                  className="cursor-pointer hover:bg-accent"
                  onClick={() => {
                    setSelected(r);
                    setSheetOpen(true);
                  }}
                >
                  <TD>
                    <div className="font-medium">
                      {r.employee.firstName} {r.employee.lastName}
                    </div>
                    <div className="text-xs text-muted-foreground">{r.employee.department ?? '—'}</div>
                  </TD>
                  <TD>
                    <span className="flex items-center gap-1.5">
                      <LeaveTypeChip code={r.leaveType.code} colorToken={r.leaveType.colorToken} />
                      {r.isLop && <LopBadge />}
                    </span>
                  </TD>
                  <TD>{fmtRange(r.startDate, r.endDate)}</TD>
                  <TD className="text-right tabular-nums">{dayLabel(r.days)}</TD>
                  <TD className="text-muted-foreground">{fmtDate(r.createdAt)}</TD>
                  <TD>
                    <LeaveStatusBadge status={r.status} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">
        {list.length} request{list.length === 1 ? '' : 's'}
        {rows != null && filter.status === 'ALL' && ' · all statuses'}
      </p>

      <RequestDetailSheet
        request={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        action={
          !readOnly &&
          selected &&
          (selected.status === 'PENDING_L1' || selected.status === 'PENDING_L2')
            ? { kind: 'decide', run: (action, comment) => decide(selected.id, action, comment) }
            : undefined
        }
      />
      {busy && null}
    </div>
  );
}
