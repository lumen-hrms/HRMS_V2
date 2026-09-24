import * as React from 'react';
import { Download, History, LogIn, ListTree } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { ROLE_LABELS } from '@/lib/roles';
import { accessApi } from '@/lib/access/client';
import { auditApi } from '@/lib/audit/client';
import { moduleLabel, type AuditEntry } from '@/lib/audit/types';
import {
  ACCESS_ACTION_LABELS,
  LOGIN_OUTCOME_LABELS,
  type AccessAuditAction,
  type AccessAuditEntry,
  type LoginAuditEntry,
  type LoginOutcome,
} from '@/lib/access/types';
import { AccessActionBadge, OutcomePill, fmtDateTimeIST } from '../shared';

type Feed = 'login' | 'access' | 'all';

/**
 * Access › Audit — append-only trail, read-only for everyone (Company Admin,
 * Auditor). Three feeds: sign-in outcomes (`LoginAuditEntry`), access changes
 * (`AccessAuditEntry`, both scoped to Identity & Access), and "All activity" —
 * the module 12 cross-module aggregation (`GET /api/audit`) spanning every
 * module that writes `public.audit_log` (employee field/salary edits,
 * attendance decisions, …), filterable by module.
 */
export function AuditTab() {
  const [feed, setFeed] = React.useState<Feed>('login');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [outcome, setOutcome] = React.useState<LoginOutcome | 'ALL'>('ALL');
  const [action, setAction] = React.useState<AccessAuditAction | 'ALL'>('ALL');
  const [module, setModule] = React.useState('ALL');
  const [q, setQ] = React.useState('');

  const [login, setLogin] = React.useState<LoginAuditEntry[] | null>(null);
  const [access, setAccess] = React.useState<AccessAuditEntry[] | null>(null);
  const [all, setAll] = React.useState<AuditEntry[] | null>(null);
  const [modules, setModules] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (feed === 'all') auditApi.modules().then(setModules);
  }, [feed]);

  React.useEffect(() => {
    if (feed === 'login') {
      setLogin(null);
      accessApi.loginAudit({ outcome, from: from || undefined, to: to || undefined, q: q || undefined }).then(setLogin);
    } else if (feed === 'access') {
      setAccess(null);
      accessApi.accessAudit({ action, from: from || undefined, to: to || undefined, q: q || undefined }).then(setAccess);
    } else {
      setAll(null);
      auditApi
        .list({ module: module === 'ALL' ? undefined : module, from: from || undefined, to: to || undefined, q: q || undefined })
        .then(setAll);
    }
  }, [feed, outcome, action, module, from, to, q]);

  function clearFilters() {
    setFrom('');
    setTo('');
    setOutcome('ALL');
    setAction('ALL');
    setModule('ALL');
    setQ('');
  }

  function exportCsv() {
    let header: string[];
    let lines: string[];
    if (feed === 'login') {
      header = ['When (IST)', 'Email', 'Outcome', 'IP', 'Device'];
      lines = (login ?? []).map((r) =>
        csvRow([fmtDateTimeIST(r.at), r.email, LOGIN_OUTCOME_LABELS[r.outcome], r.ip, r.deviceLabel ?? '']),
      );
    } else if (feed === 'access') {
      header = ['When (IST)', 'Actor', 'Actor role', 'Action', 'Target', 'Before', 'After', 'Note'];
      lines = (access ?? []).map((r) =>
        csvRow([
          fmtDateTimeIST(r.at),
          r.actorName,
          ROLE_LABELS[r.actorRole],
          ACCESS_ACTION_LABELS[r.action],
          r.targetEmail,
          r.before ?? '',
          r.after ?? '',
          r.note ?? '',
        ]),
      );
    } else {
      header = ['When (IST)', 'Module', 'Action', 'Target type', 'Target'];
      lines = (all ?? []).map((r) =>
        csvRow([fmtDateTimeIST(r.at), moduleLabel(r.module), r.action, r.targetType, r.targetId ?? '']),
      );
    }
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `access-audit-${feed}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const list = feed === 'login' ? login : feed === 'access' ? access : all;

  return (
    <div className="flex flex-col gap-4">
      {/* Sub-tabs */}
      <div className="inline-flex gap-1 rounded-md bg-muted p-1">
        <SubTab active={feed === 'login'} onClick={() => setFeed('login')} icon={LogIn}>
          Sign-in activity
        </SubTab>
        <SubTab active={feed === 'access'} onClick={() => setFeed('access')} icon={History}>
          Access changes
        </SubTab>
        <SubTab active={feed === 'all'} onClick={() => setFeed('all')} icon={ListTree}>
          All activity
        </SubTab>
      </div>

      {/* Filter bar */}
      <Card className="flex flex-wrap items-end gap-3 p-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          From
          <Input type="date" className="h-8 w-36" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          To
          <Input type="date" className="h-8 w-36" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {feed === 'login' ? (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Outcome
            <Select
              className="h-8 w-44"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as LoginOutcome | 'ALL')}
            >
              <option value="ALL">All outcomes</option>
              {(Object.keys(LOGIN_OUTCOME_LABELS) as LoginOutcome[]).map((o) => (
                <option key={o} value={o}>
                  {LOGIN_OUTCOME_LABELS[o]}
                </option>
              ))}
            </Select>
          </label>
        ) : feed === 'access' ? (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Action
            <Select
              className="h-8 w-44"
              value={action}
              onChange={(e) => setAction(e.target.value as AccessAuditAction | 'ALL')}
            >
              <option value="ALL">All actions</option>
              {(Object.keys(ACCESS_ACTION_LABELS) as AccessAuditAction[]).map((a) => (
                <option key={a} value={a}>
                  {ACCESS_ACTION_LABELS[a]}
                </option>
              ))}
            </Select>
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Module
            <Select className="h-8 w-44" value={module} onChange={(e) => setModule(e.target.value)}>
              <option value="ALL">All modules</option>
              {modules.map((m) => (
                <option key={m} value={m}>
                  {moduleLabel(m)}
                </option>
              ))}
            </Select>
          </label>
        )}
        <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Search
          <Input
            className="h-8"
            placeholder={
              feed === 'login' ? 'Email or IP…' : feed === 'access' ? 'Actor or target email…' : 'Action or actor…'
            }
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={!list || list.length === 0}
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>
      </Card>

      {/* Tables */}
      <Card className="overflow-hidden">
        {list == null ? (
          <div className="p-4">
            <SkeletonRows rows={8} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState icon={History} title="No audit entries match these filters" />
        ) : feed === 'login' ? (
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Email</TH>
                <TH>Outcome</TH>
                <TH>IP</TH>
                <TH>Device</TH>
              </TR>
            </THead>
            <TBody>
              {(login ?? []).map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap text-muted-foreground">{fmtDateTimeIST(r.at)}</TD>
                  <TD className="font-medium">{r.email}</TD>
                  <TD>
                    <OutcomePill outcome={r.outcome} />
                  </TD>
                  <TD className="font-mono text-xs">{r.ip}</TD>
                  <TD className="text-muted-foreground">{r.deviceLabel ?? '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : feed === 'all' ? (
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Module</TH>
                <TH>Action</TH>
                <TH>Target</TH>
                <TH>Details</TH>
              </TR>
            </THead>
            <TBody>
              {(all ?? []).map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap text-muted-foreground">{fmtDateTimeIST(r.at)}</TD>
                  <TD>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
                      {moduleLabel(r.module)}
                    </span>
                  </TD>
                  <TD className="font-mono text-xs">{r.action}</TD>
                  <TD className="text-muted-foreground">
                    {r.targetType}
                    {r.targetId ? `:${r.targetId.slice(0, 8)}` : ''}
                  </TD>
                  <TD className="max-w-sm truncate text-xs text-muted-foreground">
                    {String(r.metadata.actorName ?? '')}
                    {r.metadata.note ? ` · ${String(r.metadata.note)}` : ''}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Actor</TH>
                <TH>Action</TH>
                <TH>Target</TH>
                <TH>Change</TH>
                <TH>Note</TH>
              </TR>
            </THead>
            <TBody>
              {(access ?? []).map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap text-muted-foreground">{fmtDateTimeIST(r.at)}</TD>
                  <TD>
                    <div className="font-medium">{r.actorName}</div>
                    <div className="text-xs text-muted-foreground">{ROLE_LABELS[r.actorRole]}</div>
                  </TD>
                  <TD>
                    <AccessActionBadge action={r.action} />
                  </TD>
                  <TD className="font-medium">{r.targetEmail}</TD>
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
      {list != null && list.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {list.length} entr{list.length === 1 ? 'y' : 'ies'} · append-only · retained 2 years
        </p>
      )}
    </div>
  );
}

function SubTab({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof LogIn;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

function csvRow(values: string[]): string {
  return values.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
}
