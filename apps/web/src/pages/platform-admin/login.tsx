import * as React from 'react';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { platformApi, PlatformApiError } from '@/lib/platform-api';
import { AuthSplitLayout, AuthBanner, AuthField, AuthSubmitButton } from '@/components/auth/auth-split-layout';
import { AuthResetPanel } from '@/components/auth/auth-reset-panel';
import { useAuthField } from '@/components/auth/use-auth-form-field';
import { describeLoginError } from '@/components/auth/auth-errors';
import type { PlatformAdmin } from './lib/platform-auth';

/**
 * Operator sign-in — the ONLY unauthenticated surface of the console. Split-
 * panel, visibly tagged "Platform Admin" so an operator never confuses it
 * with a tenant login. Verifies a `type: platform_admin` token via
 * `POST /api/platform-admin/auth/session`.
 */
export function PlatformAdminLogin({ onAuthed }: { onAuthed: (admin: PlatformAdmin) => void }) {
  const [screen, setScreen] = React.useState<'signin' | 'reset'>('signin');
  const email = useAuthField('email');
  const password = useAuthField('password');
  const [showPassword, setShowPassword] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.validateNow() || !password.validateNow()) return;

    setLoading(true);
    try {
      const credential = await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
      const idToken = await credential.user.getIdToken();
      const res = await platformApi.session(idToken);
      if (res.status !== 'ok') throw new Error('Session could not be established');
      onAuthed(res.admin);
    } catch (err) {
      await signOut(auth).catch(() => undefined);
      setError(
        err instanceof PlatformApiError
          ? err.status === 401
            ? 'Not an operator account. This console is staff-only — tenant users sign in at their workspace URL.'
            : err.message
          : describeLoginError(err),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthSplitLayout
      operatorBadge
      taglineLines={[
        'Operator console — onboard tenants, control their lifecycle, read platform metadata.',
        'No access to any tenant’s employee, leave, or payroll data — by construction.',
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
          <p
            className="mb-6 text-[14.5px] leading-relaxed"
            style={{ color: 'var(--lumen-text-secondary)' }}
          >
            Staff-only. Manage tenants, subscriptions, and platform-wide settings.
          </p>

          {error && <AuthBanner kind="error">{error}</AuthBanner>}

          <form onSubmit={handleLogin} className="flex flex-col gap-4.5">
            <AuthField
              id="platformEmail"
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
              id="platformPassword"
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
