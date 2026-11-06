import * as React from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Pencil, Search, TriangleAlert } from 'lucide-react';
import * as payroll from '@/lib/payroll/client';
import type { LineItemPage, LineItemQuery } from '@/lib/payroll/types';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { Money } from './money';

const SEARCH_DEBOUNCE_MS = 350;
const PAGE_SIZE = 25;

type SortKey = NonNullable<LineItemQuery['sort']>;

function SortHead({
  label,
  k,
  query,
  onSort,
  className,
}: {
  label: string;
  k: SortKey;
  query: LineItemQuery;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = (query.sort ?? 'name') === k;
  return (
    <TH className={className}>
      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => onSort(k)}>
        {label}
        {active && (query.dir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </TH>
  );
}

/** The per-employee review: search, filter, sort, page — and open one for the full breakdown. */
export function ReviewTable({
  runId,
  version,
  onOpen,
}: {
  runId: string;
  /** Bump to reload after the run changed (recalculate, adjustment…). */
  version: number;
  onOpen: (employeeId: string) => void;
}) {
  const [query, setQuery] = React.useState<LineItemQuery>({ sort: 'name', dir: 'asc', page: 1, pageSize: PAGE_SIZE });
  const [searchText, setSearchText] = React.useState('');
  const [data, setData] = React.useState<LineItemPage | null>(null);
  const [error, setError] = React.useState(false);

  // Typing waits for a pause; every other control applies immediately.
  React.useEffect(() => {
    const t = window.setTimeout(() => setQuery((q) => ({ ...q, search: searchText || undefined, page: 1 })), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchText]);

  React.useEffect(() => {
    let stale = false;
    setError(false);
    payroll
      .listLineItems(runId, query)
      .then((d) => !stale && setData(d))
      .catch(() => !stale && setError(true));
    return () => {
      stale = true;
    };
  }, [runId, query, version]);

  const patch = (p: Partial<LineItemQuery>) => setQuery((q) => ({ ...q, ...p, page: 1 }));
  const onSort = (k: SortKey) =>
    setQuery((q) => ({ ...q, sort: k, dir: (q.sort ?? 'name') === k && q.dir === 'asc' ? 'desc' : 'asc', page: 1 }));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtering = !!(query.search || query.department || query.hasException || query.adjustedOnly || query.changedOver);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name or code"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-8"
            aria-label="Search employees"
          />
        </div>
        <Select
          className="w-44"
          value={query.department ?? ''}
          onChange={(e) => patch({ department: e.target.value || undefined })}
          aria-label="Department"
        >
          <option value="">All departments</option>
          {(data?.departments ?? []).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
        <Select
          className="w-48"
          value={query.changedOver ? String(query.changedOver) : ''}
          onChange={(e) => patch({ changedOver: e.target.value ? Number(e.target.value) : undefined })}
          aria-label="Change vs last month"
        >
          <option value="">Any change vs last month</option>
          <option value="5">Changed 5% or more</option>
          <option value="10">Changed 10% or more</option>
          <option value="25">Changed 25% or more</option>
        </Select>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={!!query.hasException}
            onChange={(e) => patch({ hasException: e.target.checked || undefined })}
          />
          Has exception
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={!!query.adjustedOnly}
            onChange={(e) => patch({ adjustedOnly: e.target.checked || undefined })}
          />
          Adjusted
        </label>
      </div>

      {error ? (
        <EmptyState
          icon={TriangleAlert}
          title="Couldn’t load the employees"
          action={
            <Button size="sm" onClick={() => setQuery((q) => ({ ...q }))}>
              Retry
            </Button>
          }
        />
      ) : !data ? (
        <div className="p-4">
          <SkeletonRows rows={6} />
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState title={filtering ? 'No employees match these filters' : 'This run has no employees'} className="py-10" />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <SortHead label="Employee" k="name" query={query} onSort={onSort} />
                <TH className="hidden lg:table-cell">Department</TH>
                <TH className="hidden text-right md:table-cell">Days paid</TH>
                <SortHead label="Gross" k="gross" query={query} onSort={onSort} className="text-right" />
                <TH className="hidden text-right md:table-cell">Deductions</TH>
                <SortHead label="Net pay" k="net" query={query} onSort={onSort} className="text-right" />
                <SortHead label="vs last month" k="change" query={query} onSort={onSort} className="hidden text-right sm:table-cell" />
                <TH />
              </TR>
            </THead>
            <TBody>
              {data.items.map((r) => {
                const deductions =
                  Number(r.epfEmployee) + Number(r.esiEmployee) + Number(r.professionalTax) + Number(r.tdsDeducted);
                return (
                  <TR
                    key={r.id}
                    className="cursor-pointer hover:bg-accent/50"
                    onClick={() => onOpen(r.employeeId)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && onOpen(r.employeeId)}
                  >
                    <TD>
                      <div className="font-medium">{r.employee?.name ?? r.employeeId.slice(0, 8)}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.employee?.employeeCode}
                        {r.employee?.designation ? ` · ${r.employee.designation}` : ''}
                      </div>
                    </TD>
                    <TD className="hidden lg:table-cell">{r.employee?.department ?? '—'}</TD>
                    <TD className="hidden text-right tabular-nums md:table-cell">
                      {r.payableDays}/{r.workingDays}
                      {r.lopDays > 0 && <span className="ml-1 text-xs text-warning">LOP {r.lopDays}</span>}
                    </TD>
                    <TD className="text-right"><Money value={r.grossEarnings} /></TD>
                    <TD className="hidden text-right md:table-cell"><Money value={deductions} /></TD>
                    <TD className="text-right font-medium"><Money value={r.netPay} /></TD>
                    <TD
                      className={cn(
                        'hidden text-right text-xs tabular-nums sm:table-cell',
                        r.changePct !== null && Math.abs(r.changePct) >= 10 ? 'text-warning' : 'text-muted-foreground',
                      )}
                    >
                      {r.changePct === null ? '—' : `${r.changePct > 0 ? '+' : ''}${r.changePct}%`}
                    </TD>
                    <TD className="w-16 text-right">
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        {r.hasAdjustments && <Pencil className="h-3.5 w-3.5" aria-label="Adjusted" />}
                        {r.exceptionTypes.length > 0 && (
                          <TriangleAlert className="h-3.5 w-3.5 text-warning" aria-label="Has an exception" />
                        )}
                      </span>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}

      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">
            {data.total} {data.total === 1 ? 'employee' : 'employees'}
            {filtering ? ' match' : ''} · net <Money value={data.filteredNet} className="font-medium text-foreground" />
          </span>
          <span className="flex items-center gap-1">
            <Button size="sm" variant="ghost" disabled={data.page <= 1} onClick={() => setQuery((q) => ({ ...q, page: (q.page ?? 1) - 1 }))} aria-label="Previous page">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="tabular-nums text-muted-foreground">
              {data.page} / {pages}
            </span>
            <Button size="sm" variant="ghost" disabled={data.page >= pages} onClick={() => setQuery((q) => ({ ...q, page: (q.page ?? 1) + 1 }))} aria-label="Next page">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </span>
        </div>
      )}
    </Card>
  );
}
