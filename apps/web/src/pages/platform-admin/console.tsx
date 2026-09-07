import * as React from 'react';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { platformApi, PlatformApiError } from '@/lib/platform-api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { AuthSplitLayout, AuthBanner, AuthField, AuthSubmitButton } from '@/components/auth/auth-split-layout';
import { AuthResetPanel } from '@/components/auth/auth-reset-panel';
import { useAuthField } from '@/components/auth/use-auth-form-field';
import { describeLoginError } from '@/components/auth/auth-errors';

interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
  employeeCount: number;
  subscription: { plan: string; seats: number } | null;
}

/**
 * Standalone console for the SaaS operator (the founder). Intentionally a
 * separate React tree with its own auth state — nothing here shares
 * tenant-app state, only the underlying Firebase Auth SDK instance (see
 * lib/firebase.ts); a platform admin token is a distinct custom-claim
 * shape (`type: 'platform_admin'`, no tenantId) from any tenant user's.
 */
export function PlatformAdminConsole() {
  const [authed, setAuthed] = React.useState(false);
  const [screen, setScreen] = React.useState<'signin' | 'reset'>('signin');
  const loginEmail = useAuthField('email');
  const loginPassword = useAuthField('password');
  const [showPassword, setShowPassword] = React.useState(false);
  const [loginLoading, setLoginLoading] = React.useState(false);
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
    const validEmail = loginEmail.validateNow();
    const validPassword = loginPassword.validateNow();
    if (!validEmail || !validPassword) return;

    setLoginLoading(true);
    try {
      const credential = await signInWithEmailAndPassword(auth, loginEmail.value.trim(), loginPassword.value);
      const idToken = await credential.user.getIdToken();
      const res = await platformApi.post<{ status: string }>('/auth/session', { idToken });
      if (res.status !== 'ok') throw new Error('Session could not be established');
      setAuthed(true);
    } catch (err) {
      await signOut(auth).catch(() => undefined);
      setError(err instanceof PlatformApiError ? err.message : describeLoginError(err));
    } finally {
      setLoginLoading(false);
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
      <AuthSplitLayout
        operatorBadge
        taglineLines={[
          'Platform Console — manage tenants, plans, and platform health.',
          'Full visibility and control across every workspace on Lumen.',
        ]}
      >
        {screen === 'reset' ? (
          <AuthResetPanel auth={auth} onBack={() => setScreen('signin')} />
        ) : (
          <div>
            <div className="mb-2 flex items-center gap-2.5">
              <h1 className="m-0 text-[26px] font-bold" style={{ color: 'var(--lumen-text)' }}>
                Platform admin sign-in
              </h1>
              <span
                className="rounded-[14px] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
                style={{ background: 'var(--lumen-gold-soft)', color: 'var(--lumen-gold)' }}
              >
                Platform Admin
              </span>
            </div>
            <p className="mb-6 text-[14.5px] leading-relaxed" style={{ color: 'var(--lumen-text-secondary)' }}>
              Manage tenants, subscriptions, and platform-wide settings.
            </p>

            {error && <AuthBanner kind="error">{error}</AuthBanner>}

            <form onSubmit={handleLogin} className="flex flex-col gap-4.5">
              <AuthField
                id="platformEmail"
                label="Email"
                type="email"
                placeholder="you@company.com"
                autoComplete="email"
                value={loginEmail.value}
                onChange={loginEmail.onChange}
                onBlur={loginEmail.onBlur}
                error={loginEmail.error}
              />
              <AuthField
                id="platformPassword"
                label="Password"
                placeholder="Enter your password"
                autoComplete="current-password"
                isPassword
                showPassword={showPassword}
                onToggleShow={() => setShowPassword((s) => !s)}
                value={loginPassword.value}
                onChange={loginPassword.onChange}
                onBlur={loginPassword.onBlur}
                error={loginPassword.error}
              />

              <div className="-mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setScreen('reset')}
                  className="text-[13px] font-semibold"
                  style={{ color: 'var(--lumen-gold)' }}
                >
                  Forgot password?
                </button>
              </div>

              <AuthSubmitButton loading={loginLoading}>Sign in</AuthSubmitButton>
            </form>
          </div>
        )}
      </AuthSplitLayout>
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
