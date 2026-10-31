import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { AuthSplitLayout, AuthBanner, AuthField, AuthSubmitButton } from '@/components/auth/auth-split-layout';

type Stage = 'checking' | 'form' | 'done' | 'invalid';

const MIN_LENGTH = 8;

/**
 * Landing page for the emailed password-reset link (invite, admin reset,
 * "Forgot password?"). The API swaps Firebase's hosted page for this one in
 * the link, keeping Firebase's one-time code — so it's the same flow, just
 * in the Lumen shell. Opened from `/auth/action?mode=resetPassword&oobCode=…`.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const code = params.get('mode') === 'resetPassword' ? params.get('oobCode') : null;

  const [stage, setStage] = React.useState<Stage>(code ? 'checking' : 'invalid');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [touched, setTouched] = React.useState({ password: false, confirm: false });
  const [showPassword, setShowPassword] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!code) return;
    let cancelled = false;
    verifyPasswordResetCode(auth, code)
      .then((accountEmail) => {
        if (cancelled) return;
        setEmail(accountEmail);
        setStage('form');
      })
      .catch(() => {
        if (!cancelled) setStage('invalid');
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const passwordError =
    touched.password && password.length < MIN_LENGTH
      ? `Password must be at least ${MIN_LENGTH} characters`
      : null;
  const confirmError = touched.confirm && confirm !== password ? 'Passwords don’t match' : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setTouched({ password: true, confirm: true });
    if (!code || password.length < MIN_LENGTH || confirm !== password) return;

    setLoading(true);
    try {
      await confirmPasswordReset(auth, code, password);
      setStage('done');
    } catch (err) {
      const errCode = (err as { code?: string } | undefined)?.code;
      if (errCode === 'auth/expired-action-code' || errCode === 'auth/invalid-action-code') {
        setStage('invalid');
      } else if (errCode === 'auth/weak-password') {
        setError('That password is too weak — try a longer or less common one.');
      } else if (errCode === 'auth/network-request-failed') {
        setError('Network error — check your connection and try again.');
      } else {
        setError('We couldn’t set your password. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthSplitLayout
      taglineLines={[
        'Attendance, leave, and people data in one place built for teams that move fast.',
        'One workspace for every team, tenant, and time zone.',
      ]}
    >
      <div>
        {stage === 'checking' && (
          <p className="text-[14.5px]" style={{ color: 'var(--lumen-text-secondary)' }}>
            Checking your link…
          </p>
        )}

        {stage === 'form' && (
          <>
            <h1 className="m-0 text-[26px] font-bold" style={{ color: 'var(--lumen-text)' }}>
              Set your password
            </h1>
            <p
              className="mb-6 mt-2 text-[14.5px] leading-relaxed"
              style={{ color: 'var(--lumen-text-secondary)' }}
            >
              Choose a new password for{' '}
              <span className="font-semibold" style={{ color: 'var(--lumen-text)' }}>
                {email}
              </span>
              .
            </p>

            {error && <AuthBanner kind="error">{error}</AuthBanner>}

            <form onSubmit={handleSubmit} className="flex flex-col gap-4.5">
              <AuthField
                id="newPassword"
                label="New password"
                autoComplete="new-password"
                isPassword
                showPassword={showPassword}
                onToggleShow={() => setShowPassword((v) => !v)}
                value={password}
                onChange={setPassword}
                onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                error={passwordError}
              />
              <AuthField
                id="confirmPassword"
                label="Confirm password"
                autoComplete="new-password"
                isPassword
                showPassword={showPassword}
                onToggleShow={() => setShowPassword((v) => !v)}
                value={confirm}
                onChange={setConfirm}
                onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
                error={confirmError}
              />
              <AuthSubmitButton loading={loading}>Set password</AuthSubmitButton>
            </form>
          </>
        )}

        {stage === 'done' && (
          <>
            <h1 className="m-0 text-[26px] font-bold" style={{ color: 'var(--lumen-text)' }}>
              Password updated
            </h1>
            <div className="mt-4">
              <AuthBanner kind="success">
                Your password has been set. You can now sign in with {email}.
              </AuthBanner>
            </div>
            <BackToSignIn label="Continue to sign in" primary />
          </>
        )}

        {stage === 'invalid' && (
          <>
            <h1 className="m-0 text-[26px] font-bold" style={{ color: 'var(--lumen-text)' }}>
              This link isn’t valid
            </h1>
            <div className="mt-4">
              <AuthBanner kind="error">
                The link has expired or was already used. Go to sign in and choose “Forgot password?” to get a
                new one.
              </AuthBanner>
            </div>
            <BackToSignIn label="Back to sign in" />
          </>
        )}
      </div>
    </AuthSplitLayout>
  );
}

function BackToSignIn({ label, primary }: { label: string; primary?: boolean }) {
  return primary ? (
    <Link
      to="/login"
      className="mt-1.5 flex h-[46px] w-full items-center justify-center rounded-[9px] text-[15px] font-bold"
      style={{ background: 'var(--lumen-gold)', color: '#07141F' }}
    >
      {label}
    </Link>
  ) : (
    <Link
      to="/login"
      className="mt-2 inline-block text-[13.5px] font-semibold"
      style={{ color: 'var(--lumen-text-secondary)' }}
    >
      ← {label}
    </Link>
  );
}
