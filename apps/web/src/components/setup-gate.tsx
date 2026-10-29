import * as React from 'react';
import { Navigate } from 'react-router-dom';
import { Hourglass, LogOut } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { Button } from '@/components/ui/button';
import { setupApi, type SetupStatus } from '@/lib/setup';
import { SetupStatusContext, useSetupStatus } from '@/lib/setup-status';

/**
 * Company setup status for the signed-in user's workspace. Fetched once per
 * sign-in; the setup screen calls `refresh()` after submit. If the status
 * call itself fails the app renders normally — the API still enforces
 * SETUP_INCOMPLETE on every business route, this is only the friendly
 * redirect in front of it.
 */
export function SetupStatusProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const key = user ? `${user.tenantId}:${user.sub}` : null;
  // Tagged with who it was fetched for, so switching users reads as "loading"
  // until their own status arrives.
  const [state, setState] = React.useState<{ key: string; status: SetupStatus } | null>(null);

  const fetchStatus = React.useCallback(
    // A failed status call renders the app normally; the API still enforces the gate.
    () =>
      setupApi
        .status()
        .catch(
          (): SetupStatus => ({ complete: true, completedAt: null, payrollConfigured: true, loginFailures: [] }),
        ),
    [],
  );

  const refresh = React.useCallback(async () => {
    if (!key) return;
    const status = await fetchStatus();
    setState({ key, status });
  }, [key, fetchStatus]);

  React.useEffect(() => {
    if (!key) return;
    fetchStatus().then((status) => setState({ key, status }));
  }, [key, fetchStatus]);

  const status = state && state.key === key ? state.status : null;
  return (
    <SetupStatusContext.Provider value={{ status, refresh }}>{children}</SetupStatusContext.Provider>
  );
}

/**
 * In front of the app shell: while setup is incomplete the Company Admin is
 * sent to the full-screen setup, and everyone else sees a holding screen.
 */
export function SetupGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { status } = useSetupStatus();
  if (!status) {
    return <div className="flex h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }
  if (!status.complete) {
    return user?.role === 'COMPANY_ADMIN' ? <Navigate to="/setup" replace /> : <SetupPendingScreen />;
  }
  return <>{children}</>;
}

function SetupPendingScreen() {
  const { user, logout } = useAuth();
  const { refresh } = useSetupStatus();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Hourglass className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-semibold">Your workspace is being set up</h1>
        <p className="text-sm text-muted-foreground">
          Your Company Admin is finishing the company setup — work week, holidays and leave policy. Leave,
          attendance and everything else open up as soon as they submit it.
        </p>
        <p className="text-xs text-muted-foreground">Signed in as {user?.email}</p>
        <div className="mt-2 flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            Check again
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
