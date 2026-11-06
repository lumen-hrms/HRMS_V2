import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Upload, Users } from 'lucide-react';
import * as payroll from '@/lib/payroll/client';
import type { PayrollPerson } from '@/lib/payroll/types';
import { isApiError } from '@/lib/api';
import { INDIAN_STATES, stateLabel } from '@/lib/setup';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { Money } from '../components/money';

type FilterId = 'ALL' | 'NO_SALARY_STRUCTURE' | 'NO_WORK_STATE' | 'NO_BANK' | 'NO_DOB' | 'SEPARATED';

const FILTERS: Array<{ id: FilterId; label: string; match: (p: PayrollPerson) => boolean }> = [
  { id: 'ALL', label: 'Everyone', match: () => true },
  { id: 'NO_SALARY_STRUCTURE', label: 'No structure', match: (p) => !p.hasStructure && p.lifecycleState !== 'SEPARATED' },
  { id: 'NO_WORK_STATE', label: 'No work state', match: (p) => !p.workState && p.lifecycleState !== 'SEPARATED' },
  { id: 'NO_BANK', label: 'No bank details', match: (p) => !p.hasBank && p.lifecycleState !== 'SEPARATED' },
  { id: 'NO_DOB', label: 'No date of birth', match: (p) => !p.hasDob && p.lifecycleState !== 'SEPARATED' },
  { id: 'SEPARATED', label: 'Separated · settle', match: (p) => p.lifecycleState === 'SEPARATED' },
];

const LIFECYCLE_LABEL: Record<string, string> = {
  PRE_JOINING: 'Pre-joining',
  PROBATION: 'Probation',
  CONFIRMED: 'Confirmed',
  NOTICE_PERIOD: 'Notice period',
  SUSPENDED: 'Suspended',
  SEPARATED: 'Separated',
};

export function PeopleTab() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const filterParam = params.get('filter') as FilterId | null;
  const filter: FilterId = FILTERS.some((f) => f.id === filterParam) ? (filterParam as FilterId) : 'ALL';

  const [people, setPeople] = React.useState<PayrollPerson[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkState, setBulkState] = React.useState('');
  const [applying, setApplying] = React.useState(false);

  const load = React.useCallback(() => {
    setError(null);
    payroll
      .listPeople()
      .then(setPeople)
      .catch((err) => {
        setPeople([]);
        setError(isApiError(err) ? err.message : 'Could not load employees');
      });
  }, []);
  React.useEffect(load, [load]);

  const q = search.trim().toLowerCase();
  const active = FILTERS.find((f) => f.id === filter)!;
  const rows = (people ?? []).filter(
    (p) => active.match(p) && (!q || p.name.toLowerCase().includes(q) || p.employeeCode.toLowerCase().includes(q)),
  );
  const counts = new Map(FILTERS.map((f) => [f.id, (people ?? []).filter(f.match).length]));
  const selectable = rows.filter((p) => p.lifecycleState !== 'SEPARATED');
  const allSelected = selectable.length > 0 && selectable.every((p) => selected.has(p.id));

  function setFilter(id: FilterId) {
    setSelected(new Set());
    setParams(id === 'ALL' ? { tab: 'people' } : { tab: 'people', filter: id });
  }

  async function applyWorkState() {
    if (!bulkState || selected.size === 0) return;
    setApplying(true);
    try {
      const { updated } = await payroll.bulkSetWorkState([...selected], bulkState);
      toast({ title: `Work state set for ${updated} ${updated === 1 ? 'employee' : 'employees'}`, tone: 'success' });
      setSelected(new Set());
      setBulkState('');
      load();
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Could not update work state', tone: 'error' });
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search name or code" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" aria-label="Search employees" />
        </div>
        <Button variant="outline" className="ml-auto" onClick={() => navigate('/payroll/import')}>
          <Upload className="h-4 w-4" /> Import salaries
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const n = counts.get(f.id) ?? 0;
          const on = f.id === filter;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              aria-pressed={on}
              className={cn(
                'rounded-full border px-3 py-1 text-sm',
                on ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-accent',
              )}
            >
              {f.label}
              {people && f.id !== 'ALL' && <span className={cn('ml-1.5 text-xs', on ? '' : n > 0 ? 'text-warning' : 'text-muted-foreground')}>{n}</span>}
            </button>
          );
        })}
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <Select className="w-52" value={bulkState} onChange={(e) => setBulkState(e.target.value)} aria-label="Work state to apply">
            <option value="">Set work state to…</option>
            {INDIAN_STATES.map((s) => (
              <option key={s} value={s}>
                {stateLabel(s)}
              </option>
            ))}
          </Select>
          <Button size="sm" disabled={!bulkState || applying} onClick={applyWorkState}>
            {applying ? 'Applying…' : 'Apply'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        {error ? (
          <div className="flex items-center justify-between gap-2 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={load}>
              Retry
            </Button>
          </div>
        ) : !people ? (
          <div className="p-4">
            <SkeletonRows rows={6} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Users} title="No employees match" description={filter !== 'ALL' ? 'Nothing needs fixing here.' : undefined} className="py-10" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH className="w-10">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input"
                      aria-label="Select all"
                      checked={allSelected}
                      onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((p) => p.id)) : new Set())}
                    />
                  </TH>
                  <TH>Employee</TH>
                  <TH className="hidden lg:table-cell">Department</TH>
                  <TH className="hidden md:table-cell">Work state</TH>
                  <TH className="hidden text-right md:table-cell">Annual CTC</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Action</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((p) => {
                  const separated = p.lifecycleState === 'SEPARATED';
                  return (
                    <TR key={p.id}>
                      <TD>
                        {!separated && (
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-input"
                            aria-label={`Select ${p.name}`}
                            checked={selected.has(p.id)}
                            onChange={(e) =>
                              setSelected((s) => {
                                const n = new Set(s);
                                if (e.target.checked) n.add(p.id);
                                else n.delete(p.id);
                                return n;
                              })
                            }
                          />
                        )}
                      </TD>
                      <TD>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {p.employeeCode} · {p.designation ?? '—'}
                        </div>
                      </TD>
                      <TD className="hidden lg:table-cell">{p.department ?? '—'}</TD>
                      <TD className="hidden md:table-cell">{p.workState ? stateLabel(p.workState) : <span className="text-warning">Not set</span>}</TD>
                      <TD className="hidden text-right md:table-cell">{p.ctcAnnual ? <Money value={p.ctcAnnual} /> : <span className="text-muted-foreground">—</span>}</TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          {separated ? (
                            <Badge variant="outline">{LIFECYCLE_LABEL[p.lifecycleState]}</Badge>
                          ) : (
                            <>
                              {!p.hasStructure && <Badge variant="warning">No structure</Badge>}
                              {!p.workState && <Badge variant="warning">No work state</Badge>}
                              {!p.hasBank && <Badge variant="outline">No bank</Badge>}
                              {!p.hasDob && <Badge variant="outline">No DOB</Badge>}
                              {p.hasStructure && p.workState && p.hasBank && p.hasDob && <Badge variant="success">Ready</Badge>}
                            </>
                          )}
                        </div>
                      </TD>
                      <TD className="text-right">
                        {separated ? (
                          <Button size="sm" variant="outline" onClick={() => navigate(`/payroll/fnf/${p.id}`)}>
                            Full &amp; Final
                          </Button>
                        ) : (
                          <Button size="sm" variant={p.hasStructure ? 'outline' : 'default'} onClick={() => navigate(`/payroll/structures/${p.id}`)}>
                            {p.hasStructure ? 'Structure' : 'Set up'}
                          </Button>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
