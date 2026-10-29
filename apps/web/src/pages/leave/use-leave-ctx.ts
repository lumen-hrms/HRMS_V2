import * as React from 'react';
import { useAuth } from '@/context/auth-context';
import { USE_MOCK, type LeaveCtx } from '@/lib/leave/client';
import { ME_ID } from '@/lib/leave/fixtures';

/**
 * Builds the `LeaveCtx` the mock client needs (role + own employee id). With
 * the real API this context is implicit in the bearer token; the client still
 * takes it so the two modes share one call signature.
 *
 * Memoized so it's stable across renders and safe to list in effect deps.
 * Returns null while auth is loading or there's no user.
 */
export function useLeaveCtx(): (LeaveCtx & { email: string }) | null {
  const { user } = useAuth();
  return React.useMemo(() => {
    if (!user) return null;
    return {
      role: user.role,
      // Only the fixture store understands ME_ID; the live API needs a real
      // employee id, so an unlinked login gets null and the self-service
      // tabs show the "no employee profile" state instead of calling it.
      employeeId: user.employeeId ?? (USE_MOCK ? ME_ID : null),
      email: user.email,
    };
  }, [user?.role, user?.employeeId, user?.email]);
}
