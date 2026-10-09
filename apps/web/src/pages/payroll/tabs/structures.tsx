import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import type { EmployeeSummary } from '@/lib/payroll/types';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';

const LIFECYCLE_LABEL: Record<string, string> = {
  PRE_JOINING: 'Pre-joining',
  PROBATION: 'Probation',
  CONFIRMED: 'Confirmed',
  NOTICE_PERIOD: 'Notice period',
  SUSPENDED: 'Suspended',
  SEPARATED: 'Separated',
};

export function StructuresTab() {
  const navigate = useNavigate();
  const [employees, setEmployees] = React.useState<EmployeeSummary[] | null>(null);
  const [search, setSearch] = React.useState('');
  const [lifecycleFilter, setLifecycleFilter] = React.useState('');

  React.useEffect(() => {
    api.get<EmployeeSummary[]>('/employees').then(setEmployees);
  }, []);

  const filtered = React.useMemo(() => {
    if (!employees) return null;
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (lifecycleFilter && e.lifecycleState !== lifecycleFilter) return false;
      if (!q) return true;
      return (
        `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
        e.employeeCode.toLowerCase().includes(q)
      );
    });
  }, [employees, search, lifecycleFilter]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select
          value={lifecycleFilter}
          onChange={(e) => setLifecycleFilter(e.target.value)}
          className="w-44"
        >
          <option value="">All lifecycle states</option>
          {Object.entries(LIFECYCLE_LABEL).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      <Card className="overflow-hidden">
        {!filtered ? (
          <div className="p-4">
            <SkeletonRows rows={5} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Wallet} title="No employees match" className="py-10" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Department</TH>
                <TH>Lifecycle</TH>
                <TH className="text-right">Action</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((e) => (
                <TR key={e.id}>
                  <TD>
                    <div className="font-medium">
                      {e.firstName} {e.lastName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {e.employeeCode} · {e.designation ?? '—'}
                    </div>
                  </TD>
                  <TD>{e.department?.name ?? '—'}</TD>
                  <TD>
                    <Badge variant={e.lifecycleState === 'SEPARATED' ? 'outline' : 'default'}>
                      {LIFECYCLE_LABEL[e.lifecycleState] ?? e.lifecycleState}
                    </Badge>
                  </TD>
                  <TD className="text-right">
                    {e.lifecycleState === 'SEPARATED' ? (
                      <Button size="sm" variant="outline" onClick={() => navigate(`/payroll/fnf/${e.id}`)}>
                        Full &amp; Final
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => navigate(`/payroll/structures/${e.id}`)}>
                        Structure
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
