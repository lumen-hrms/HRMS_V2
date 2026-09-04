import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/auth-context';
import { auth } from '@/lib/firebase';
import { getTenantSubdomain } from '@/lib/api';
import { AuthSplitLayout, AuthBanner, AuthField, AuthSubmitButton } from '@/components/auth/auth-split-layout';
import { AuthResetPanel } from '@/components/auth/auth-reset-panel';
import { useAuthField } from '@/components/auth/use-auth-form-field';
import { describeLoginError } from '@/components/auth/auth-errors';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [screen, setScreen] = React.useState<'signin' | 'reset'>('signin');

  const subdomain = useAuthField('subdomain', getTenantSubdomain() ?? '');
  const email = useAuthField('email');
  const password = useAuthField('password');
  const [showPassword, setShowPassword] = React.useState(false);

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const validSubdomain = subdomain.validateNow();
    const validEmail = email.validateNow();
    const validPassword = password.validateNow();
    if (!validSubdomain || !validEmail || !validPassword) return;

    setLoading(true);
    try {
      await login(subdomain.value.trim(), email.value.trim(), password.value);
      setSuccess(true);
      setTimeout(() => navigate('/'), 400);
    } catch (err) {
      setError(describeLoginError(err));
      setLoading(false);
    }
  }

  return (
    <AuthSplitLayout
      taglineLines={[
        'Attendance, leave, and people data in one place — built for teams that move fast.',
        'One workspace for every team, tenant, and time zone.',
      ]}
    >
      {screen === 'reset' ? (
        <AuthResetPanel auth={auth} onBack={() => setScreen('signin')} />
      ) : (
        <div>
          <h1 className="m-0 text-[26px] font-bold" style={{ color: 'var(--lumen-text)' }}>
            Sign in to your workspace
          </h1>
          <p className="mb-6 mt-2 text-[14.5px] leading-relaxed" style={{ color: 'var(--lumen-text-secondary)' }}>
            Enter your workspace details to continue.
          </p>

          {error && <AuthBanner kind="error">{error}</AuthBanner>}
          {success && <AuthBanner kind="success">Signed in — redirecting to your workspace…</AuthBanner>}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4.5">
            <AuthField
              id="subdomain"
              label="Company subdomain"
              placeholder="acme"
              value={subdomain.value}
              onChange={subdomain.onChange}
              onBlur={subdomain.onBlur}
              error={subdomain.error}
            />
            <AuthField
              id="email"
              label="Email"
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              value={email.value}
              onChange={email.onChange}
              onBlur={email.onBlur}
              error={email.error}
            />
            <AuthField
              id="password"
              label="Password"
              placeholder="Enter your password"
              autoComplete="current-password"
              isPassword
              showPassword={showPassword}
              onToggleShow={() => setShowPassword((s) => !s)}
              value={password.value}
              onChange={password.onChange}
              onBlur={password.onBlur}
              error={password.error}
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

            <AuthSubmitButton loading={loading}>Sign in</AuthSubmitButton>
          </form>
        </div>
      )}
    </AuthSplitLayout>
  );
}
