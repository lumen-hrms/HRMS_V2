import * as React from 'react';
import { Link } from 'react-router-dom';
import { Eye, Plus, Search, Upload, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
  department: { name: string } | null;
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

export function EmployeeListPage() {
  const { user } = useAuth();
  const [employees, setEmployees] = React.useState<Employee[] | null>(null);
  const [departments, setDepartments] = React.useState<Department[]>([]);
  const [search, setSearch] = React.useState('');
  const [departmentFilter, setDepartmentFilter] = React.useState('');
  const [lifecycleFilter, setLifecycleFilter] = React.useState('');
  const [quickViewId, setQuickViewId] = React.useState<string | null>(null);
  const [quickView, setQuickView] = React.useState<EmployeeQuickView | null>(null);

  React.useEffect(() => {
    api.get<Employee[]>('/employees').then(setEmployees);
    api.get<Department[]>('/departments').then(setDepartments).catch(() => setDepartments([]));
  }, []);

  React.useEffect(() => {
    if (!quickViewId) {
      setQuickView(null);
      return;
    }
    setQuickView(null);
    api.get<EmployeeQuickView>(`/employees/${quickViewId}`).then(setQuickView);
  }, [quickViewId]);

  const filtered = React.useMemo(() => {
    if (!employees) return null;
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (departmentFilter && e.department?.name !== departmentFilter) return false;
      if (lifecycleFilter && e.lifecycleState !== lifecycleFilter) return false;
      if (!q) return true;
      return (
        `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
        e.employeeCode.toLowerCase().includes(q) ||
        (e.designation ?? '').toLowerCase().includes(q)
      );
    });
  }, [employees, search, departmentFilter, lifecycleFilter]);

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
        <StatTile label="Headcount" value={stats.total} icon={Users} />
        <StatTile label="Confirmed" value={stats.confirmed} tone="success" />
        <StatTile label="In probation" value={stats.probation} tone="warning" />
        <StatTile label="Notice / separated" value={stats.exiting} tone="destructive" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search name, code, designation…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          className="w-auto"
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.name}>
              {d.name}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto"
          value={lifecycleFilter}
          onChange={(e) => setLifecycleFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          {Object.entries(STATE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Name</th>
              <th className="px-4 py-2.5 text-left font-medium">Code</th>
              <th className="px-4 py-2.5 text-left font-medium">Department</th>
              <th className="px-4 py-2.5 text-left font-medium">Designation</th>
              <th className="px-4 py-2.5 text-left font-medium">Manager</th>
              <th className="px-4 py-2.5 text-left font-medium">Status</th>
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

function StatTile({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
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
        <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
      </div>
      {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
    </Card>
  );
}
