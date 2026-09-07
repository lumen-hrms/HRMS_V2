import * as React from 'react';
import { sendPasswordResetEmail, type Auth } from 'firebase/auth';
import { AuthBanner, AuthField, AuthSubmitButton } from './auth-split-layout';
import { useAuthField } from './use-auth-form-field';

/** Shared "forgot password?" sub-view for both the tenant and Platform
 * Admin sign-in screens — same Firebase Auth instance either way, so the
 * only thing that differs per caller is which `auth` object to send the
 * real reset email through. */
export function AuthResetPanel({ auth, onBack }: { auth: Auth; onBack: () => void }) {
  const email = useAuthField('email');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.validateNow()) return;
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.value.trim());
      setSent(true);
    } catch (err: any) {
      // Deliberately non-revealing either way — a real "no such account"
      // still shows the generic success copy. Only surface a banner for
      // something actually actionable (rate limiting, network failure).
      if (err?.code === 'auth/too-many-requests') {
        setError('Too many attempts. Please wait a few minutes and try again.');
      } else if (err?.code === 'auth/network-request-failed') {
        setError('Network error — check your connection and try again.');
      } else {
        setSent(true);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="m-0 text-[26px] font-bold" style={{ color: 'var(--lumen-text)' }}>
        Reset your password
      </h1>

      {!sent && (
        <>
          <p className="mb-6 mt-2 text-[14.5px] leading-relaxed" style={{ color: 'var(--lumen-text-secondary)' }}>
            Enter the email on your account and we&rsquo;ll send you a link to reset your password.
          </p>

          {error && <AuthBanner kind="error">{error}</AuthBanner>}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4.5">
            <AuthField
              id="resetEmail"
              label="Email address"
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              value={email.value}
              onChange={email.onChange}
              onBlur={email.onBlur}
              error={email.error}
            />
            <AuthSubmitButton loading={loading}>Send reset link</AuthSubmitButton>
          </form>
        </>
      )}

      {sent && (
        <div className="mt-2">
          <AuthBanner kind="success">
            If an account exists for {email.value.trim()}, we&rsquo;ve sent a link to reset the password.
          </AuthBanner>
        </div>
      )}

      <button
        type="button"
        onClick={onBack}
        className="mt-4 text-[13.5px] font-semibold"
        style={{ color: 'var(--lumen-text-secondary)' }}
      >
        ← Back to sign in
      </button>
    </div>
  );
}
