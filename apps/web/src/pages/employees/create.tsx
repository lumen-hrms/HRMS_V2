import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { isApiError } from '@/context/auth-context';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Department {
  id: string;
  name: string;
}
interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
}

export function EmployeeCreatePage() {
  const navigate = useNavigate();
  const [departments, setDepartments] = React.useState<Department[]>([]);
  const [managers, setManagers] = React.useState<EmployeeOption[]>([]);
  const [form, setForm] = React.useState({
    employeeCode: '',
    firstName: '',
    lastName: '',
    designation: '',
    departmentId: '',
    reportingManagerId: '',
    loginEmail: '',
    loginTempPassword: '',
    loginRole: 'EMPLOYEE',
  });
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    api.get<Department[]>('/departments').then(setDepartments);
    api.get<EmployeeOption[]>('/employees').then(setManagers);
  }, []);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload: Record<string, string> = { ...form };
      Object.keys(payload).forEach((k) => {
        if (!payload[k]) delete payload[k];
      });
      const employee = await api.post<{ id: string }>('/employees', payload);
      navigate(`/employees/${employee.id}`);
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Failed to create employee');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="mb-5 text-xl font-semibold">Add employee</h1>
      <Card>
        <CardHeader>
          <CardTitle>Employment details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Employee code" value={form.employeeCode} onChange={(v) => set('employeeCode', v)} required />
              <Field label="Designation" value={form.designation} onChange={(v) => set('designation', v)} />
              <Field label="First name" value={form.firstName} onChange={(v) => set('firstName', v)} required />
              <Field label="Last name" value={form.lastName} onChange={(v) => set('lastName', v)} required />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Department</Label>
                <select
                  className="h-9 rounded-md border border-input bg-card px-2 text-sm"
                  value={form.departmentId}
                  onChange={(e) => set('departmentId', e.target.value)}
                >
                  <option value="">—</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Reporting manager</Label>
                <select
                  className="h-9 rounded-md border border-input bg-card px-2 text-sm"
                  value={form.reportingManagerId}
                  onChange={(e) => set('reportingManagerId', e.target.value)}
                >
                  <option value="">—</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.firstName} {m.lastName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <hr className="my-1 border-border" />
            <p className="text-xs font-medium text-muted-foreground">
              Optional: create a login for this employee
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Login email" type="email" value={form.loginEmail} onChange={(v) => set('loginEmail', v)} />
              <Field
                label="Temp password"
                type="text"
                value={form.loginTempPassword}
                onChange={(v) => set('loginTempPassword', v)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Role</Label>
              <select
                className="h-9 rounded-md border border-input bg-card px-2 text-sm"
                value={form.loginRole}
                onChange={(e) => set('loginRole', e.target.value)}
              >
                {['EMPLOYEE', 'LINE_MANAGER', 'HR_MANAGER', 'COMPANY_ADMIN', 'AUDITOR'].map((r) => (
                  <option key={r} value={r}>
                    {r.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy} className="mt-2 self-start">
              {busy ? 'Saving…' : 'Create employee'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} />
    </div>
  );
}
