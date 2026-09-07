import * as React from 'react';
import { useAuth } from '@/context/auth-context';
import type { AccessCtx } from '@/lib/access/client';
import { humanizeEmail } from './shared';

/**
 * Builds the `AccessCtx` the mock client needs (who is acting). With the real
 * API this is implicit in the bearer token; the client still takes it so the
 * two modes share one call signature.
 *
 * Memoized so it's stable across renders and safe to list in effect deps.
 * Returns null while auth is loading or there's no user.
 */
export function useAccessCtx(): AccessCtx | null {
  const { user } = useAuth();
  return React.useMemo(() => {
    if (!user) return null;
    return {
      userId: user.sub,
      role: user.role,
      email: user.email,
      name: humanizeEmail(user.email),
    };
  }, [user?.sub, user?.role, user?.email]);
}
