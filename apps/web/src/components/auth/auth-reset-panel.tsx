import * as React from 'react';
import { sendPasswordResetEmail, type Auth } from 'firebase/auth';
import { isApiError, requestPasswordReset } from '@/lib/api';
import { AuthBanner, AuthField, AuthSubmitButton } from './auth-split-layout';
import { useAuthField } from './use-auth-form-field';

/** Shared "forgot password?" sub-view for both sign-in screens.
 *
 * - Tenant sign-in passes `tenantSubdomain`: the request goes to our API,
 *   which emails a branded reset link from the workspace's domain via SES.
 * - Platform Admin sign-in passes only `auth`: operators aren't tenant
 *   users, so they keep Firebase's own reset email. */
export function AuthResetPanel({
  auth,
  onBack,
  tenantSubdomain,
}: {
  auth: Auth;
  onBack: () => void;
  tenantSubdomain?: string;
}) {
  const isTenant = tenantSubdomain !== undefined;
  const subdomain = useAuthField('subdomain', tenantSubdomain ?? '');
  const email = useAuthField('email');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const validEmail = email.validateNow();
    const validSubdomain = !isTenant || subdomain.validateNow();
    if (!validEmail || !validSubdomain) return;
    setLoading(true);
    try {
      if (isTenant) {
        await requestPasswordReset(subdomain.value.trim(), email.value.trim());
      } else {
        await sendPasswordResetEmail(auth, email.value.trim());
      }
      setSent(true);
    } catch (err: any) {
      // Deliberately non-revealing either way — a real "no such account"
      // still shows the generic success copy. Only surface a banner for
      // something actually actionable (rate limiting, network failure, a
      // workspace that doesn't exist).
      if (err?.code === 'auth/too-many-requests' || (isApiError(err) && err.status === 429)) {
        setError('Too many attempts. Please wait a few minutes and try again.');
      } else if (isApiError(err) && err.status === 404) {
        setError('We couldn’t find that company subdomain — check it and try again.');
      } else if (err?.code === 'auth/network-request-failed' || err instanceof TypeError) {
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
            {isTenant && (
              <AuthField
                id="resetSubdomain"
                label="Company Subdomain"
                placeholder="acme"
                autoComplete="organization"
                value={subdomain.value}
                onChange={subdomain.onChange}
                onBlur={subdomain.onBlur}
                error={subdomain.error}
              />
            )}
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
