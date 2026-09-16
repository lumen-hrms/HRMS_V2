import * as React from 'react';
import { Download, ScrollText } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { platformApi } from '@/lib/platform-api';
import { AUDIT_ACTION_LABEL, type PlatformAuditAction, type PlatformAuditEntry } from './lib/types';
import { fmtDateTime } from './lib/format';

export function PlatformAuditPage() {
  const [rows, setRows] = React.useState<PlatformAuditEntry[] | null>(null);
  const [notWired, setNotWired] = React.useState(false);
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [action, setAction] = React.useState<PlatformAuditAction | 'ALL'>('ALL');
  const [q, setQ] = React.useState('');

  React.useEffect(() => {
    setRows(null);
    setNotWired(false);
    platformApi
      .getAudit({
        action: action === 'ALL' ? undefined : action,
        from: from || undefined,
        to: to || undefined,
        q: q || undefined,
      })
      .then(setRows)
      .catch(() => {
        setRows([]);
        setNotWired(true);
      });
  }, [action, from, to, q]);

  function exportCsv() {
    const head = ['When (IST)', 'Operator', 'Action', 'Tenant', 'Before', 'After', 'Note'];
    const lines = (rows ?? []).map((r) =>
      [
        fmtDateTime(r.at),
        r.actorEmail,
        AUDIT_ACTION_LABEL[r.action],
        r.targetTenantName ?? '',
        r.before ?? '',
        r.after ?? '',
        r.note ?? '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `platform-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Audit log"
        description="Every operator action — append-only, retained for the platform record."
      />

      <Card className="flex flex-wrap items-end gap-3 p-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          From
          <Input type="date" className="h-8 w-36" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          To
          <Input type="date" className="h-8 w-36" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Action
          <Select
            className="h-8 w-48"
            value={action}
            onChange={(e) => setAction(e.target.value as PlatformAuditAction | 'ALL')}
          >
            <option value="ALL">All actions</option>
            {(Object.keys(AUDIT_ACTION_LABEL) as PlatformAuditAction[]).map((a) => (
              <option key={a} value={a}>
                {AUDIT_ACTION_LABEL[a]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Search
          <Input className="h-8" placeholder="Operator or tenant…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setFrom('');
            setTo('');
            setAction('ALL');
            setQ('');
          }}
        >
          Clear
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows || rows.length === 0}>
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </Card>

      <Card className="overflow-hidden">
        {rows == null ? (
          <div className="p-4">
            <Skeleton className="h-40 w-full" />
          </div>
        ) : notWired ? (
          <EmptyState
            icon={ScrollText}
            title="Couldn't load the audit log"
            description="The request to GET /api/platform-admin/audit failed. Check the API is reachable and try again."
          />
        ) : rows.length === 0 ? (
          <EmptyState icon={ScrollText} title="No audit entries match these filters" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Operator</TH>
                <TH>Action</TH>
                <TH>Tenant</TH>
                <TH>Change</TH>
                <TH>Note</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.at)}</TD>
                  <TD className="font-medium">{r.actorEmail}</TD>
                  <TD>{AUDIT_ACTION_LABEL[r.action]}</TD>
                  <TD>{r.targetTenantName ?? '—'}</TD>
                  <TD className="text-muted-foreground">
                    {r.before && r.after ? `${r.before} → ${r.after}` : '—'}
                  </TD>
                  <TD className="max-w-xs text-xs text-muted-foreground">{r.note ?? '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {rows != null && rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {rows.length} entr{rows.length === 1 ? 'y' : 'ies'} · append-only
        </p>
      )}
    </div>
  );
}
