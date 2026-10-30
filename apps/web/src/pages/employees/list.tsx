import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpDown, Eye, Plus, Search, Upload, Users, X } from 'lucide-react';
import { api, isApiError } from '@/lib/api';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/context/auth-context';

interface Employee {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  designation: string | null;
  lifecycleState: string;
  employmentType: string | null;
  workLocation: string | null;
  dateOfJoining: string | null;
  department: { name: string } | null;
  reportingManagerId: string | null;
  reportingManager: { firstName: string; lastName: string } | null;
}

// The full detail shape — fetched on demand when the quick-view drawer
// opens, so the directory's own list payload stays light.
interface EmployeeQuickView extends Employee {
  personalEmail: string | null;
  phone: string | null;
  workLocation: string | null;
  employmentType: string | null;
  photoUrl: string | null;
}

interface Department {
  id: string;
  name: string;
}

const CAN_CREATE = ['COMPANY_ADMIN', 'HR_MANAGER'];

const STATE_LABEL: Record<string, string> = {
  PRE_JOINING: 'Pre-joining',
  PROBATION: 'Probation',
  CONFIRMED: 'Confirmed',
  NOTICE_PERIOD: 'Notice period',
  SUSPENDED: 'Suspended',
  SEPARATED: 'Separated',
};

const STATE_BADGE_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'outline'> = {
  PRE_JOINING: 'outline',
  PROBATION: 'warning',
  CONFIRMED: 'success',
  NOTICE_PERIOD: 'warning',
  SUSPENDED: 'destructive',
  SEPARATED: 'outline',
};

type SortKey = 'name' | 'code' | 'department' | 'designation' | 'manager' | 'status' | 'joined';

interface View {
  search: string;
  department: string;
  lifecycle: string;
  employmentType: string;
  location: string;
  manager: string;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
}

const DEFAULT_VIEW: View = {
  search: '',
  department: '',
  lifecycle: '',
  employmentType: '',
  location: '',
  manager: '',
  sortKey: 'name',
  sortDir: 'asc',
};

// Kept for the browser session so a profile's "Back to employees" lands on the
// same sorted/filtered list instead of resetting it.
const VIEW_KEY = 'lumen.employees.view';

function readView(): View {
  let saved = DEFAULT_VIEW;
  try {
    saved = { ...DEFAULT_VIEW, ...JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? '{}') };
  } catch {
    // no saved view
  }
  // Arriving from a department's "View people" link: that department only, nothing else filtered.
  const department = new URLSearchParams(window.location.search).get('department');
  return department
    ? { ...DEFAULT_VIEW, sortKey: saved.sortKey, sortDir: saved.sortDir, department }
    : saved;
}

const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;
const humanize = (v: string) => {
  const t = v.replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const STATE_ORDER = Object.keys(STATE_LABEL);
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

const sortValue = (e: Employee, key: SortKey): string | number | null => {
  switch (key) {
    case 'name':
      return fullName(e);
    case 'code':
      return e.employeeCode;
    case 'department':
      return e.department?.name ?? null;
    case 'designation':
      return e.designation;
    case 'manager':
      return e.reportingManager ? fullName(e.reportingManager) : null;
    case 'status':
      return STATE_ORDER.indexOf(e.lifecycleState);
    case 'joined':
      return e.dateOfJoining ? new Date(e.dateOfJoining).getTime() : null;
  }
};

const formatJoined = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
    : '—';

// Every way to order the directory; the column headers drive the same state.
const SORT_OPTIONS: { key: SortKey; dir: 'asc' | 'desc'; label: string }[] = [
  { key: 'name', dir: 'asc', label: 'Name (A–Z)' },
  { key: 'name', dir: 'desc', label: 'Name (Z–A)' },
  { key: 'code', dir: 'asc', label: 'Employee ID (low to high)' },
  { key: 'code', dir: 'desc', label: 'Employee ID (high to low)' },
  { key: 'department', dir: 'asc', label: 'Department (A–Z)' },
  { key: 'department', dir: 'desc', label: 'Department (Z–A)' },
  { key: 'designation', dir: 'asc', label: 'Designation (A–Z)' },
  { key: 'designation', dir: 'desc', label: 'Designation (Z–A)' },
  { key: 'manager', dir: 'asc', label: 'Reporting manager (A–Z)' },
  { key: 'manager', dir: 'desc', label: 'Reporting manager (Z–A)' },
  { key: 'joined', dir: 'desc', label: 'Joining date (newest first)' },
  { key: 'joined', dir: 'asc', label: 'Joining date (oldest first)' },
  { key: 'status', dir: 'asc', label: 'Status (joining → exiting)' },
  { key: 'status', dir: 'desc', label: 'Status (exiting → joining)' },
];

export function EmployeeListPage() {
  const { user } = useAuth();
  const [employees, setEmployees] = React.useState<Employee[] | null>(null);
  const [departments, setDepartments] = React.useState<Department[]>([]);
  const [view, setView] = React.useState<View>(readView);
  const patch = (p: Partial<View>) => setView((v) => ({ ...v, ...p }));
  const { search, department: departmentFilter, lifecycle: lifecycleFilter } = view;

  React.useEffect(() => {
    try {
      sessionStorage.setItem(VIEW_KEY, JSON.stringify(view));
    } catch {
      // storage unavailable — the view just won't survive navigation
    }
  }, [view]);
  const [quickViewId, setQuickViewId] = React.useState<string | null>(null);
  const [quickView, setQuickView] = React.useState<EmployeeQuickView | null>(null);

  const [loadError, setLoadError] = React.useState<string | null>(null);
  const loadEmployees = React.useCallback(() => {
    api
      .get<Employee[]>('/employees')
      .then((list) => {
        setEmployees(list);
        setLoadError(null);
      })
      .catch((err) => setLoadError(isApiError(err) ? err.message : 'Could not load employees'));
  }, []);

  React.useEffect(() => {
    loadEmployees();
    api.get<Department[]>('/departments').then(setDepartments).catch(() => setDepartments([]));
  }, [loadEmployees]);

  React.useEffect(() => {
    if (!quickViewId) {
      setQuickView(null);
      return;
    }
    setQuickView(null);
    api.get<EmployeeQuickView>(`/employees/${quickViewId}`).then(setQuickView);
  }, [quickViewId]);

  // Filter choices come from the data actually in the directory.
  const filterChoices = React.useMemo(() => {
    const all = employees ?? [];
    const types = [...new Set(all.map((e) => e.employmentType).filter((v): v is string => !!v))];
    const locations = [...new Set(all.map((e) => e.workLocation?.trim()).filter((v): v is string => !!v))];
    const managers = new Map<string, ComboboxOption>();
    for (const e of all) {
      if (e.reportingManagerId && e.reportingManager) {
        managers.set(e.reportingManagerId, { value: e.reportingManagerId, label: fullName(e.reportingManager) });
      }
    }
    return {
      types: types.sort((a, b) => collator.compare(humanize(a), humanize(b))),
      locations: locations.sort(collator.compare),
      managers: [...managers.values()].sort((a, b) => collator.compare(a.label, b.label)),
    };
  }, [employees]);

  const filtered = React.useMemo(() => {
    if (!employees) return null;
    const q = search.trim().toLowerCase();
    const dir = view.sortDir === 'asc' ? 1 : -1;
    return employees
      .filter((e) => {
        if (departmentFilter && e.department?.name !== departmentFilter) return false;
        if (lifecycleFilter && e.lifecycleState !== lifecycleFilter) return false;
        if (view.employmentType && e.employmentType !== view.employmentType) return false;
        if (view.location && e.workLocation?.trim() !== view.location) return false;
        if (view.manager && e.reportingManagerId !== view.manager) return false;
        if (!q) return true;
        return (
          fullName(e).toLowerCase().includes(q) ||
          e.employeeCode.toLowerCase().includes(q) ||
          (e.designation ?? '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const av = sortValue(a, view.sortKey);
        const bv = sortValue(b, view.sortKey);
        // Blank values go last whichever way it's sorted; ties fall back to name A–Z.
        if (av === null || av === '') return bv === null || bv === '' ? collator.compare(fullName(a), fullName(b)) : 1;
        if (bv === null || bv === '') return -1;
        const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : collator.compare(String(av), String(bv));
        return c !== 0 ? c * dir : collator.compare(fullName(a), fullName(b));
      });
  }, [employees, search, departmentFilter, lifecycleFilter, view.employmentType, view.location, view.manager, view.sortKey, view.sortDir]);

  const filtersActive = !!(search || departmentFilter || lifecycleFilter || view.employmentType || view.location || view.manager);

  function toggleSort(key: SortKey) {
    setView((v) => ({ ...v, sortKey: key, sortDir: v.sortKey === key && v.sortDir === 'asc' ? 'desc' : 'asc' }));
  }

  const stats = React.useMemo(() => {
    const all = employees ?? [];
    return {
      total: all.length,
      confirmed: all.filter((e) => e.lifecycleState === 'CONFIRMED').length,
      probation: all.filter((e) => e.lifecycleState === 'PROBATION').length,
      exiting: all.filter((e) => e.lifecycleState === 'NOTICE_PERIOD' || e.lifecycleState === 'SEPARATED').length,
    };
  }, [employees]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Employees</h1>
          <p className="text-sm text-muted-foreground">Central directory for your organization.</p>
        </div>
        {user && CAN_CREATE.includes(user.role) && (
          <div className="flex items-center gap-2">
            <Link to="/employees/import" className={buttonVariants({ variant: 'outline' })}>
              <Upload className="h-4 w-4" /> Bulk import
            </Link>
            <Link to="/employees/new" className={buttonVariants({ variant: 'default' })}>
              <Plus className="h-4 w-4" /> Add employee
            </Link>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Headcount" value={employees && stats.total} icon={Users} />
        <StatTile label="Confirmed" value={employees && stats.confirmed} tone="success" />
        <StatTile label="In probation" value={employees && stats.probation} tone="warning" />
        <StatTile label="Notice / separated" value={employees && stats.exiting} tone="destructive" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search name, code, designation…"
            value={search}
            onChange={(e) => patch({ search: e.target.value })}
          />
        </div>
        <Select className="w-auto" value={departmentFilter} onChange={(e) => patch({ department: e.target.value })}>
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.name}>
              {d.name}
            </option>
          ))}
        </Select>
        <Select className="w-auto" value={lifecycleFilter} onChange={(e) => patch({ lifecycle: e.target.value })}>
          <option value="">All statuses</option>
          {Object.entries(STATE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        {filterChoices.types.length > 1 && (
          <Select className="w-auto" value={view.employmentType} onChange={(e) => patch({ employmentType: e.target.value })}>
            <option value="">All employment types</option>
            {filterChoices.types.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
        )}
        {filterChoices.locations.length > 1 && (
          <Select className="w-auto" value={view.location} onChange={(e) => patch({ location: e.target.value })}>
            <option value="">All locations</option>
            {filterChoices.locations.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
        )}
        {filterChoices.managers.length > 0 && (
          <div className="w-56">
            <Combobox
              value={view.manager}
              onChange={(manager) => patch({ manager })}
              options={filterChoices.managers}
              clearLabel="All managers"
              placeholder="All managers"
              searchPlaceholder="Search managers…"
            />
          </div>
        )}
        {filtersActive && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setView((v) => ({ ...DEFAULT_VIEW, sortKey: v.sortKey, sortDir: v.sortDir }))}
          >
            <X className="h-3.5 w-3.5" /> Clear filters
          </Button>
        )}
        <div className="ml-auto flex items-center gap-3">
          {employees && (
            <span className="text-xs text-muted-foreground">
              {filtered?.length === employees.length
                ? `${employees.length} ${employees.length === 1 ? 'person' : 'people'}`
                : `Showing ${filtered?.length ?? 0} of ${employees.length}`}
            </span>
          )}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Sort by
            <Select
              className="w-auto text-foreground"
              value={`${view.sortKey}:${view.sortDir}`}
              onChange={(e) => {
                const [sortKey, sortDir] = e.target.value.split(':') as [SortKey, 'asc' | 'desc'];
                patch({ sortKey, sortDir });
              }}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={`${o.key}:${o.dir}`} value={`${o.key}:${o.dir}`}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </div>

      <Card className="overflow-hidden">
        {!employees && !loadError && (
          <div className="flex flex-col gap-3 p-4" role="status" aria-live="polite">
            <p className="text-sm text-muted-foreground">Fetching employees…</p>
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        )}
        {!employees && loadError && (
          <div className="flex flex-col items-center gap-2 p-8 text-center text-sm">
            <p className="text-destructive">{loadError}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setLoadError(null);
                loadEmployees();
              }}
            >
              Try again
            </Button>
          </div>
        )}
        {employees && (
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <SortableTh label="Name" k="name" view={view} onSort={toggleSort} />
              <SortableTh label="Code" k="code" view={view} onSort={toggleSort} />
              <SortableTh label="Department" k="department" view={view} onSort={toggleSort} />
              <SortableTh label="Designation" k="designation" view={view} onSort={toggleSort} />
              <SortableTh label="Manager" k="manager" view={view} onSort={toggleSort} />
              <SortableTh label="Joined" k="joined" view={view} onSort={toggleSort} />
              <SortableTh label="Status" k="status" view={view} onSort={toggleSort} />
              <th className="px-4 py-2.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered?.map((e) => (
              <tr
                key={e.id}
                className={`border-t border-border hover:bg-accent ${e.id === quickViewId ? 'bg-accent' : ''}`}
              >
                <td className="px-4 py-2.5">
                  <Link to={`/employees/${e.id}`} className="font-medium hover:underline">
                    {e.firstName} {e.lastName}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{e.employeeCode}</td>
                <td className="px-4 py-2.5">{e.department?.name ?? '—'}</td>
                <td className="px-4 py-2.5">{e.designation ?? '—'}</td>
                <td className="px-4 py-2.5">
                  {e.reportingManager ? `${e.reportingManager.firstName} ${e.reportingManager.lastName}` : '—'}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{formatJoined(e.dateOfJoining)}</td>
                <td className="px-4 py-2.5">
                  <Badge variant={STATE_BADGE_VARIANT[e.lifecycleState] ?? 'outline'}>
                    {STATE_LABEL[e.lifecycleState] ?? e.lifecycleState}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Button size="sm" variant="ghost" title="Quick view" onClick={() => setQuickViewId(e.id)}>
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
        {filtered?.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {employees?.length === 0
              ? 'No employees visible to your role yet.'
              : 'No employees match these filters.'}
          </p>
        )}
      </Card>

      <Sheet
        open={!!quickViewId}
        onOpenChange={(open) => !open && setQuickViewId(null)}
        title={quickView ? `${quickView.firstName} ${quickView.lastName}` : 'Loading…'}
        description={quickView ? `${quickView.employeeCode} · ${quickView.designation ?? 'No designation set'}` : undefined}
        footer={
          quickViewId && (
            <Link
              to={`/employees/${quickViewId}`}
              className={`${buttonVariants({ variant: 'default' })} w-full`}
            >
              Open full profile
            </Link>
          )
        }
      >
        {!quickView ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Badge variant={STATE_BADGE_VARIANT[quickView.lifecycleState] ?? 'outline'} className="w-fit">
              {STATE_LABEL[quickView.lifecycleState] ?? quickView.lifecycleState}
            </Badge>
            <div className="grid grid-cols-2 gap-3 rounded-md bg-muted p-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Reporting manager</p>
                <p className="font-medium">
                  {quickView.reportingManager
                    ? `${quickView.reportingManager.firstName} ${quickView.reportingManager.lastName}`
                    : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Department</p>
                <p className="font-medium">{quickView.department?.name ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Work location</p>
                <p className="font-medium">{quickView.workLocation ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Employment type</p>
                <p className="font-medium">{quickView.employmentType?.replace('_', ' ') ?? '—'}</p>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span className="truncate text-muted-foreground">{quickView.personalEmail ?? 'No personal email on file'}</span>
            </div>
            {quickView.phone && <p className="text-sm text-muted-foreground">{quickView.phone}</p>}
          </div>
        )}
      </Sheet>
    </div>
  );
}

function SortableTh({
  label,
  k,
  view,
  onSort,
}: {
  label: string;
  k: SortKey;
  view: View;
  onSort: (k: SortKey) => void;
}) {
  const active = view.sortKey === k;
  const Icon = !active ? ArrowUpDown : view.sortDir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      className="px-4 py-2.5 text-left font-medium"
      aria-sort={active ? (view.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${active ? 'text-foreground' : ''}`}
      >
        {label}
        <Icon className={`h-3.5 w-3.5 ${active ? '' : 'opacity-50'}`} />
      </button>
    </th>
  );
}

function StatTile({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  /** null while the data is still loading. */
  value: number | null;
  tone?: 'success' | 'warning' | 'destructive';
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'destructive'
          ? 'text-destructive'
          : 'text-foreground';
  return (
    <Card className="flex items-center justify-between p-4">
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value ?? '—'}</p>
      </div>
      {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
    </Card>
  );
}
