import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/auth-context';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getTenantSubdomain, isApiError } from '@/lib/api';

type Step =
  | { kind: 'credentials' }
  | { kind: 'mfa'; challengeToken: string }
  | { kind: 'enroll'; challengeToken: string; qrCodeDataUrl: string };

export function LoginPage() {
  const { login, verifyMfa, completeMfaEnrollment } = useAuth();
  const navigate = useNavigate();
  const [subdomain, setSubdomain] = React.useState(getTenantSubdomain() ?? '');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [code, setCode] = React.useState('');
  const [step, setStep] = React.useState<Step>({ kind: 'credentials' });
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await login(subdomain.trim(), email.trim(), password);
      if (res.status === 'ok') {
        navigate('/');
      } else if (res.status === 'mfa_required') {
        setStep({ kind: 'mfa', challengeToken: res.mfaChallengeToken! });
      } else if (res.status === 'mfa_enrollment_required') {
        setStep({
          kind: 'enroll',
          challengeToken: res.mfaChallengeToken!,
          qrCodeDataUrl: res.qrCodeDataUrl!,
        });
      }
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleMfaVerify(e: React.FormEvent) {
    e.preventDefault();
    if (step.kind !== 'mfa') return;
    setError(null);
    setBusy(true);
    try {
      await verifyMfa(step.challengeToken, code);
      navigate('/');
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  }

  async function handleEnrollVerify(e: React.FormEvent) {
    e.preventDefault();
    if (step.kind !== 'enroll') return;
    setError(null);
    setBusy(true);
    try {
      await completeMfaEnrollment(step.challengeToken, code);
      navigate('/');
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-1 flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground font-semibold">
            H
          </div>
          <CardTitle>
            {step.kind === 'credentials' && 'Sign in to HRMS Platform'}
            {step.kind === 'mfa' && 'Enter your authenticator code'}
            {step.kind === 'enroll' && 'Set up two-factor authentication'}
          </CardTitle>
          <CardDescription>
            {step.kind === 'credentials' && 'Enter your company subdomain and credentials.'}
            {step.kind === 'mfa' && 'Open your authenticator app and enter the 6-digit code.'}
            {step.kind === 'enroll' &&
              'Your role requires MFA. Scan this QR code in Google Authenticator or Authy, then enter the code it shows.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step.kind === 'credentials' && (
            <form onSubmit={handleCredentials} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="subdomain">Company subdomain</Label>
                <Input
                  id="subdomain"
                  placeholder="acme"
                  value={subdomain}
                  onChange={(e) => setSubdomain(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={busy} className="mt-1">
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          )}

          {step.kind === 'mfa' && (
            <form onSubmit={handleMfaVerify} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="code">Authentication code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={busy}>
                {busy ? 'Verifying…' : 'Verify'}
              </Button>
            </form>
          )}

          {step.kind === 'enroll' && (
            <form onSubmit={handleEnrollVerify} className="flex flex-col gap-3">
              <img
                src={step.qrCodeDataUrl}
                alt="MFA enrollment QR code"
                className="mx-auto h-40 w-40 rounded-md border border-border"
              />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="enroll-code">Code from your authenticator app</Label>
                <Input
                  id="enroll-code"
                  inputMode="numeric"
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={busy}>
                {busy ? 'Verifying…' : 'Activate & sign in'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
