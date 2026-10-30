import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Building2, Crown, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { api, isApiError } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { PageHeader } from '@/components/page-header';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/context/auth-context';
import { hueVar } from '@/pages/org-chart/model';

interface Department {
  id: string;
  name: string;
  code: string | null;
  headEmployeeId: string | null;
}

interface Person {
  id: string;
  firstName: string;
  lastName: string;
  designation: string | null;
  lifecycleState: string;
  departmentId: string | null;
  department: { name: string } | null;
}

type SortKey = 'name-asc' | 'name-desc' | 'people-desc' | 'people-asc' | 'code';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'name-asc', label: 'Name (A–Z)' },
  { key: 'name-desc', label: 'Name (Z–A)' },
  { key: 'people-desc', label: 'Most people first' },
  { key: 'people-asc', label: 'Fewest people first' },
  { key: 'code', label: 'Code' },
];

// Roles that see the whole company, so department headcounts are accurate.
const SEES_EVERYONE = ['COMPANY_ADMIN', 'HR_MANAGER', 'AUDITOR'];

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
const initialsOf = (p: { firstName: string; lastName: string }) =>
  `${p.firstName[0] ?? ''}${p.lastName[0] ?? ''}`.toUpperCase() || '—';

export function DepartmentsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  // null = still fetching (so we never claim "No departments yet" before we know).
  const [departments, setDepartments] = React.useState<Department[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [people, setPeople] = React.useState<Person[] | null>(null);
  const [search, setSearch] = React.useState('');
  const [sort, setSort] = React.useState<SortKey>('name-asc');
  const [formFor, setFormFor] = React.useState<Department | 'new' | null>(null);
  const [deleting, setDeleting] = React.useState<Department | null>(null);
  const canManage = !!user && ['COMPANY_ADMIN', 'HR_MANAGER'].includes(user.role);
  const seesEveryone = !!user && SEES_EVERYONE.includes(user.role);

  const load = React.useCallback(() => {
    api
      .get<Department[]>('/departments')
      .then((list) => {
        setDepartments(list);
        setLoadError(null);
      })
      .catch((err) => setLoadError(isApiError(err) ? err.message : 'Could not load departments'));
    if (seesEveryone) {
      api
        .get<Person[]>('/employees')
        .then(setPeople)
        .catch(() => setPeople(null));
    }
  }, [seesEveryone]);
  React.useEffect(load, [load]);

  const counts = React.useMemo(() => {
    const byDept = new Map<string, number>();
    let unassigned = 0;
    let total = 0;
    for (const p of people ?? []) {
      if (p.lifecycleState === 'SEPARATED') continue;
      total++;
      if (p.departmentId) byDept.set(p.departmentId, (byDept.get(p.departmentId) ?? 0) + 1);
      else unassigned++;
    }
    return { byDept, unassigned, total };
  }, [people]);
  const peopleById = React.useMemo(() => new Map((people ?? []).map((p) => [p.id, p])), [people]);

  const visible = React.useMemo(() => {
    if (!departments) return null;
    const q = search.trim().toLowerCase();
    const count = (d: Department) => counts.byDept.get(d.id) ?? 0;
    return departments
      .filter((d) => {
        if (!q) return true;
        const head = d.headEmployeeId ? peopleById.get(d.headEmployeeId) : undefined;
        return [d.name, d.code ?? '', head ? fullName(head) : ''].some((s) => s.toLowerCase().includes(q));
      })
      .sort((a, b) => {
        switch (sort) {
          case 'name-desc':
            return collator.compare(b.name, a.name);
          case 'people-desc':
            return count(b) - count(a) || collator.compare(a.name, b.name);
          case 'people-asc':
            return count(a) - count(b) || collator.compare(a.name, b.name);
          case 'code':
            if (!a.code !== !b.code) return a.code ? -1 : 1;
            return collator.compare(a.code ?? '', b.code ?? '') || collator.compare(a.name, b.name);
          default:
            return collator.compare(a.name, b.name);
        }
      });
  }, [departments, search, sort, counts, peopleById]);

  const largest = React.useMemo(() => {
    let best: { name: string; n: number } | null = null;
    for (const d of departments ?? []) {
      const n = counts.byDept.get(d.id) ?? 0;
      if (n > 0 && (!best || n > best.n)) best = { name: d.name, n };
    }
    return best;
  }, [departments, counts]);
  const maxCount = Math.max(1, ...(departments ?? []).map((d) => counts.byDept.get(d.id) ?? 0));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Departments"
        description="Organizational units used across employees, the org chart and reports."
        actions={
          canManage && (
            <Button onClick={() => setFormFor('new')}>
              <Plus className="h-4 w-4" /> Add department
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Departments" value={departments ? departments.length : null} icon={Building2} />
        {seesEveryone && (
          <>
            <StatTile label="People" value={people ? counts.total : null} icon={Users} />
            <StatTile
              label="Largest team"
              value={people ? (largest ? largest.n : 0) : null}
              hint={largest?.name}
            />
            <StatTile
              label="Without a department"
              value={people ? counts.unassigned : null}
              tone={counts.unassigned > 0 ? 'warning' : undefined}
            />
          </>
        )}
      </div>

      {departments && departments.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search name, code or head…"
              aria-label="Search departments"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            Sort by
            <Select
              className="w-auto text-foreground"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              {SORTS.filter((s) => seesEveryone || !s.key.startsWith('people')).map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
          </label>
        </div>
      )}

      {!departments && !loadError && (
        <div className="flex flex-col gap-3" role="status" aria-live="polite">
          <p className="text-sm text-muted-foreground">Fetching departments…</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-44 w-full rounded-xl" />
            ))}
          </div>
        </div>
      )}

      {!departments && loadError && (
        <Card>
          <EmptyState
            icon={Building2}
            title="Couldn’t load departments"
            description={loadError}
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setLoadError(null);
                  load();
                }}
              >
                Try again
              </Button>
            }
          />
        </Card>
      )}

      {departments?.length === 0 && (
        <Card>
          <EmptyState
            icon={Building2}
            title="No departments yet"
            description="Create your first department to start organising people."
            action={
              canManage && (
                <Button size="sm" onClick={() => setFormFor('new')}>
                  <Plus className="h-4 w-4" /> Add department
                </Button>
              )
            }
          />
        </Card>
      )}

      {visible && departments && departments.length > 0 && visible.length === 0 && (
        <Card>
          <EmptyState
            icon={Search}
            title="No departments match"
            description={`Nothing matches “${search.trim()}”.`}
            action={
              <Button size="sm" variant="outline" onClick={() => setSearch('')}>
                Clear search
              </Button>
            }
          />
        </Card>
      )}

      {visible && visible.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visible.map((d) => (
            <DepartmentCard
              key={d.id}
              department={d}
              head={d.headEmployeeId ? peopleById.get(d.headEmployeeId) : undefined}
              count={people ? counts.byDept.get(d.id) ?? 0 : null}
              maxCount={maxCount}
              canManage={canManage}
              onEdit={() => setFormFor(d)}
              onDelete={() => setDeleting(d)}
            />
          ))}
        </div>
      )}

      {formFor && (
        <DepartmentFormDialog
          department={formFor === 'new' ? null : formFor}
          people={people ?? []}
          onOpenChange={(open) => !open && setFormFor(null)}
          onSaved={() => {
            const creating = formFor === 'new';
            setFormFor(null);
            load();
            toast({ title: creating ? 'Department added' : 'Department saved' });
          }}
        />
      )}

      {deleting && (
        <DeleteDepartmentDialog
          department={deleting}
          departments={departments ?? []}
          onOpenChange={(open) => !open && setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            load();
            toast({ title: 'Department deleted' });
          }}
        />
      )}
    </div>
  );
}

function DepartmentCard({
  department,
  head,
  count,
  maxCount,
  canManage,
  onEdit,
  onDelete,
}: {
  department: Department;
  head: Person | undefined;
  count: number | null;
  maxCount: number;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hue = hueVar(department.id); // same colour as this department in the org chart
  const former = head?.lifecycleState === 'SEPARATED';
  return (
    <Card className="group relative flex flex-col overflow-hidden p-0 transition-shadow hover:shadow-md">
      <span aria-hidden="true" className="h-1 w-full" style={{ background: hue }} />
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold leading-tight" title={department.name}>
              {department.name}
            </h2>
            {department.code ? (
              <Badge variant="outline" className="mt-1.5">
                {department.code}
              </Badge>
            ) : (
              <p className="mt-1.5 text-xs text-muted-foreground">No code</p>
            )}
          </div>
          {canManage && (
            <div className="-mr-1 -mt-1 flex shrink-0 items-center gap-0.5">
              <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${department.name}`} title="Edit">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Delete ${department.name}`} title="Delete">
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          {head ? (
            <>
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                style={{ color: hue, background: `color-mix(in srgb, ${hue} 16%, var(--card))` }}
              >
                {initialsOf(head)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {fullName(head)}
                  {former && <span className="font-normal text-muted-foreground"> (former)</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">Department head</p>
              </div>
            </>
          ) : (
            <>
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground"
              >
                <Crown className="h-3.5 w-3.5" />
              </span>
              <p className="text-sm text-muted-foreground">
                {department.headEmployeeId ? 'Head assigned' : 'No head assigned'}
              </p>
            </>
          )}
        </div>

        <div className="mt-auto flex flex-col gap-2">
          {count !== null && (
            <>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium tabular-nums">
                  {count} {count === 1 ? 'person' : 'people'}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(count / maxCount) * 100}%`, background: hue }}
                />
              </div>
            </>
          )}
          <Link
            to={`/employees?department=${encodeURIComponent(department.name)}`}
            className="mt-1 inline-flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            View people <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </Card>
  );
}

function StatTile({
  label,
  value,
  hint,
  tone,
  icon: Icon,
}: {
  label: string;
  /** null while the data is still loading. */
  value: number | null;
  hint?: string;
  tone?: 'warning';
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="flex items-center justify-between p-4">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold ${tone === 'warning' ? 'text-warning' : ''}`}>{value ?? '—'}</p>
        {hint && (
          <p className="truncate text-xs text-muted-foreground" title={hint}>
            {hint}
          </p>
        )}
      </div>
      {Icon && <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />}
    </Card>
  );
}

/** Add (department = null) or edit a department: name, short code, and its head. */
function DepartmentFormDialog({
  department,
  people,
  onOpenChange,
  onSaved,
}: {
  department: Department | null;
  people: Person[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(department?.name ?? '');
  const [code, setCode] = React.useState(department?.code ?? '');
  const [headId, setHeadId] = React.useState(department?.headEmployeeId ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const headOptions = React.useMemo<ComboboxOption[]>(() => {
    const options = people
      .filter((p) => p.lifecycleState !== 'SEPARATED')
      .map((p) => ({
        value: p.id,
        label: fullName(p),
        description: [p.designation, p.department?.name].filter(Boolean).join(' · '),
      }));
    return options.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  }, [people]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (department) {
        await api.patch(`/departments/${department.id}`, {
          name: name.trim(),
          code: code.trim(),
          headEmployeeId: headId || null,
        });
      } else {
        await api.post('/departments', {
          name: name.trim(),
          code: code.trim() || undefined,
          headEmployeeId: headId || undefined,
        });
      }
      onSaved();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not save the department');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={department ? 'Edit department' : 'Add department'}
          description={department ? undefined : 'Group people so reports and the org chart can use it.'}
          onClose={() => onOpenChange(false)}
        />
        <form onSubmit={save} className="flex flex-col gap-4">
          <Field label="Name" required>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aerodynamics" />
          </Field>
          <Field label="Code" hint="Short code shown beside the name, e.g. AERO">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="AERO" />
          </Field>
          {people.length > 0 && (
            <Field label="Department head">
              <Combobox
                value={headId}
                onChange={setHeadId}
                options={headOptions}
                clearLabel="No head assigned"
                placeholder="Select a head"
                searchPlaceholder="Search by name, title or department…"
              />
            </Field>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? 'Saving…' : department ? 'Save' : 'Add department'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDepartmentDialog({
  department,
  departments,
  onOpenChange,
  onDeleted,
}: {
  department: Department;
  departments: Department[];
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [reassignTo, setReassignTo] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const otherDepartments = departments.filter((d) => d.id !== department.id);

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/departments/${department.id}`, {
        reassignToDepartmentId: reassignTo || undefined,
      });
      onDeleted();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not delete department');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={`Delete "${department.name}"`}
          description="If this department still has employees, choose where they move first."
          onClose={() => onOpenChange(false)}
        />
        <div className="flex flex-col gap-4">
          <Field label="Reassign employees to" hint="Only needed if the department isn't empty">
            <Select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
              <option value="">— none —</option>
              {otherDepartments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete department'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
