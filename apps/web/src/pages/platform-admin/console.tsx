import * as React from 'react';
import { platformApi, setPlatformToken, PlatformApiError } from '@/lib/platform-api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
  employeeCount: number;
  subscription: { plan: string; seats: number } | null;
}

type LoginStep =
  | { kind: 'credentials' }
  | { kind: 'mfa'; token: string }
  | { kind: 'enroll'; token: string; qr: string };

/**
 * Standalone console for the SaaS operator (the founder). Intentionally a
 * separate React tree with its own auth state — nothing here shares a
 * token, a Prisma connection, or even an HTTP client with the tenant app.
 */
export function PlatformAdminConsole() {
  const [authed, setAuthed] = React.useState(false);
  const [step, setStep] = React.useState<LoginStep>({ kind: 'credentials' });
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [tenants, setTenants] = React.useState<Tenant[]>([]);
  const [createForm, setCreateForm] = React.useState({
    companyName: '',
    subdomain: '',
    adminEmail: '',
    adminTempPassword: '',
  });

  const loadTenants = React.useCallback(() => {
    platformApi.get<Tenant[]>('/tenants').then(setTenants);
  }, []);

  React.useEffect(() => {
    if (authed) loadTenants();
  }, [authed, loadTenants]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await platformApi.post<any>('/auth/login', { email, password });
      if (res.status === 'mfa_enrollment_required') {
        setStep({ kind: 'enroll', token: res.mfaChallengeToken, qr: res.qrCodeDataUrl });
      } else if (res.status === 'mfa_required') {
        setStep({ kind: 'mfa', token: res.mfaChallengeToken });
      }
    } catch (err) {
      setError(err instanceof PlatformApiError ? err.message : 'Login failed');
    }
  }

  async function handleMfa(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const path = step.kind === 'enroll' ? '/auth/mfa/enroll/verify' : '/auth/mfa/verify';
      const token = step.kind === 'enroll' || step.kind === 'mfa' ? step.token : '';
      const res = await platformApi.post<{ accessToken: string }>(path, {
        mfaChallengeToken: token,
        code,
      });
      setPlatformToken(res.accessToken);
      setAuthed(true);
    } catch (err) {
      setError(err instanceof PlatformApiError ? err.message : 'Invalid code');
    }
  }

  async function handleCreateTenant(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await platformApi.post('/tenants', createForm);
      setCreateForm({ companyName: '', subdomain: '', adminEmail: '', adminTempPassword: '' });
      loadTenants();
    } catch (err) {
      setError(err instanceof PlatformApiError ? err.message : 'Failed to create tenant');
    }
  }

  async function toggleStatus(t: Tenant) {
    const next = t.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    await platformApi.patch(`/tenants/${t.id}/status`, { status: next });
    loadTenants();
  }

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Platform Admin Console</CardTitle>
            <CardDescription>SaaS operator access — separate from tenant accounts.</CardDescription>
          </CardHeader>
          <CardContent>
            {step.kind === 'credentials' && (
              <form onSubmit={handleLogin} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Email</Label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Password</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit">Sign in</Button>
              </form>
            )}
            {(step.kind === 'mfa' || step.kind === 'enroll') && (
              <form onSubmit={handleMfa} className="flex flex-col gap-3">
                {step.kind === 'enroll' && (
                  <img src={step.qr} alt="MFA QR" className="mx-auto h-40 w-40 rounded-md border border-border" />
                )}
                <div className="flex flex-col gap-1.5">
                  <Label>Authenticator code</Label>
                  <Input value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit">Verify</Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-8 text-foreground">
      <h1 className="mb-1 text-xl font-semibold">Platform Admin Console</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Tenant metadata only — this console has no access to any tenant's employee, leave, or
        payroll data.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader>
            <CardTitle>Tenants</CardTitle>
          </CardHeader>
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Company</th>
                <th className="px-4 py-2 text-left font-medium">Subdomain</th>
                <th className="px-4 py-2 text-left font-medium">Plan</th>
                <th className="px-4 py-2 text-left font-medium">Employees</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="px-4 py-2.5 font-medium">{t.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{t.subdomain}</td>
                  <td className="px-4 py-2.5">{t.subscription?.plan ?? '—'}</td>
                  <td className="px-4 py-2.5">{t.employeeCount}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={t.status === 'ACTIVE' ? 'success' : t.status === 'TRIAL' ? 'outline' : 'destructive'}>
                      {t.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button size="sm" variant="ghost" onClick={() => toggleStatus(t)}>
                      {t.status === 'SUSPENDED' ? 'Enable' : 'Suspend'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Provision a new tenant</CardTitle>
            <CardDescription>Creates the tenant and its first Company Admin login.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateTenant} className="flex flex-col gap-3">
              <Field
                label="Company name"
                value={createForm.companyName}
                onChange={(v) => setCreateForm((f) => ({ ...f, companyName: v }))}
              />
              <Field
                label="Subdomain"
                value={createForm.subdomain}
                onChange={(v) => setCreateForm((f) => ({ ...f, subdomain: v }))}
              />
              <Field
                label="Admin email"
                type="email"
                value={createForm.adminEmail}
                onChange={(v) => setCreateForm((f) => ({ ...f, adminEmail: v }))}
              />
              <Field
                label="Admin temp password"
                value={createForm.adminTempPassword}
                onChange={(v) => setCreateForm((f) => ({ ...f, adminTempPassword: v }))}
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit">Create tenant</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} required />
    </div>
  );
}
