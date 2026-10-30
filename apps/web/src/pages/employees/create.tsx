import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { isApiError, useAuth } from '@/context/auth-context';
import { ROLE_LABELS } from '@/lib/roles';
import { useLinkableLogins } from '@/pages/employees/linkable-logins';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
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
  designation: string | null;
  lifecycleState: string;
  department: { name: string } | null;
}

type LoginMode = 'none' | 'new' | 'link';

/** Pause after the last keystroke before asking the server whether the code is taken. */
const CODE_CHECK_DEBOUNCE_MS = 400;

export function EmployeeCreatePage() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
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
    existingUserId: '',
  });
  const [loginMode, setLoginMode] = React.useState<LoginMode>('none');
  const linkableLogins = useLinkableLogins();
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [codeCheck, setCodeCheck] = React.useState<{
    code: string;
    result: 'available' | 'taken' | 'error';
  } | null>(null);
  const code = form.employeeCode.trim();

  // A–Z by name; ex-employees can't be picked as a manager.
  const managerOptions = React.useMemo<ComboboxOption[]>(
    () =>
      managers
        .filter((m) => m.lifecycleState !== 'SEPARATED')
        .map((m) => ({
          value: m.id,
          label: `${m.firstName} ${m.lastName}`,
          description: [m.designation, m.department?.name].filter(Boolean).join(' · '),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })),
    [managers],
  );

  React.useEffect(() => {
    api.get<Department[]>('/departments').then(setDepartments);
    api.get<EmployeeOption[]>('/employees').then(setManagers);
  }, []);

  // Debounced "does this employee code already exist?" check. Only the latest
  // keystroke's answer is kept; the server still enforces uniqueness on save.
  React.useEffect(() => {
    if (!code) return;
    let stale = false;
    const timer = window.setTimeout(() => {
      api
        .get<{ available: boolean }>(`/employees/code-available?code=${encodeURIComponent(code)}`)
        .then((r) => !stale && setCodeCheck({ code, result: r.available ? 'available' : 'taken' }))
        .catch(() => !stale && setCodeCheck({ code, result: 'error' }));
    }, CODE_CHECK_DEBOUNCE_MS);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [code]);
  // 'checking' covers both the debounce wait and the request in flight.
  const codeStatus = !code ? 'idle' : codeCheck?.code === code ? codeCheck.result : 'checking';

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { loginEmail, loginTempPassword, loginRole, existingUserId, ...rest } = form;
      const payload: Record<string, string> = {
        ...rest,
        employeeCode: code,
        ...(loginMode === 'new' ? { loginEmail, loginTempPassword, loginRole } : {}),
        ...(loginMode === 'link' ? { existingUserId } : {}),
      };
      Object.keys(payload).forEach((k) => {
        if (!payload[k]) delete payload[k];
      });
      const employee = await api.post<{ id: string }>('/employees', payload);
      // Linking your own login changes your employeeId — pick it up now so
      // Leave/Attendance self-service work without signing in again.
      if (loginMode === 'link' && existingUserId === user?.sub) await refreshUser();
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
              <Field
                label="Employee code"
                value={form.employeeCode}
                onChange={(v) => set('employeeCode', v)}
                required
                invalid={codeStatus === 'taken'}
                status={<CodeStatus status={codeStatus} />}
              />
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
                <Combobox
                  value={form.reportingManagerId}
                  onChange={(id) => set('reportingManagerId', id)}
                  options={managerOptions}
                  clearLabel="No reporting manager"
                  placeholder="Select a manager"
                  searchPlaceholder="Search by name, title or department…"
                />
              </div>
            </div>

            <hr className="my-1 border-border" />
            <div className="flex flex-col gap-1.5">
              <Label>Login</Label>
              <select
                className="h-9 rounded-md border border-input bg-card px-2 text-sm"
                value={loginMode}
                onChange={(e) => setLoginMode(e.target.value as LoginMode)}
              >
                <option value="none">No login for now</option>
                <option value="new">Create a new login</option>
                <option value="link">Link an existing login</option>
              </select>
            </div>

            {loginMode === 'new' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Login email" type="email" value={form.loginEmail} onChange={(v) => set('loginEmail', v)} required />
                  <Field
                    label="Temp password"
                    type="text"
                    value={form.loginTempPassword}
                    onChange={(v) => set('loginTempPassword', v)}
                    required
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
              </>
            )}

            {loginMode === 'link' &&
              (linkableLogins?.length === 0 ? (
                <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                  Every login in this workspace is already linked to an employee — including yours, if company
                  setup created your profile. To give this person a login, choose <strong>Create a new login</strong>{' '}
                  instead.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Label>Existing login</Label>
                  <select
                    className="h-9 rounded-md border border-input bg-card px-2 text-sm"
                    value={form.existingUserId}
                    onChange={(e) => set('existingUserId', e.target.value)}
                    disabled={linkableLogins === null}
                    required
                  >
                    <option value="">{linkableLogins === null ? 'Loading…' : 'Select a login'}</option>
                    {linkableLogins?.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.email} · {ROLE_LABELS[u.role]}
                        {u.id === user?.sub ? ' (you)' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Logins without an employee record. The login keeps its current role.
                  </p>
                </div>
              ))}

            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              disabled={busy || codeStatus === 'taken' || (loginMode === 'link' && linkableLogins?.length === 0)}
              className="mt-2 self-start"
            >
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
  invalid,
  status,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  invalid?: boolean;
  /** Small line under the input (e.g. a live availability check). */
  status?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        aria-invalid={invalid || undefined}
        className={invalid ? 'border-destructive focus-visible:ring-destructive' : undefined}
      />
      {status}
    </div>
  );
}

function CodeStatus({ status }: { status: 'idle' | 'checking' | 'available' | 'taken' | 'error' }) {
  if (status === 'idle') return null;
  const base = 'flex items-center gap-1.5 text-xs';
  if (status === 'checking')
    return (
      <p className={`${base} text-muted-foreground`} role="status">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
      </p>
    );
  if (status === 'available')
    return (
      <p className={`${base} text-success`} role="status">
        <Check className="h-3.5 w-3.5" /> Employee code is available
      </p>
    );
  if (status === 'taken')
    return (
      <p className={`${base} text-destructive`} role="alert">
        <X className="h-3.5 w-3.5" /> This employee code already exists
      </p>
    );
  return <p className={`${base} text-muted-foreground`}>Couldn’t check right now — it will be checked when you save.</p>;
}
