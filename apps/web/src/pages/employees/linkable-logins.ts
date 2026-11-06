import * as React from 'react';
import { useAuth } from '@/context/auth-context';
import { accessApi } from '@/lib/access/client';
import type { AccessUser } from '@/lib/access/types';
import { assignableRoles } from '@/lib/roles';

/**
 * Logins in this workspace that have no employee record yet and that the
 * signed-in user may link — the same RULE-2 ceiling the API enforces in
 * `EmployeesService.assertLinkableLogin` (an HR Manager can't link a Company
 * Admin's login). Right after onboarding this is just the Company Admin.
 */
export function useLinkableLogins(enabled = true): AccessUser[] | null {
  const { user } = useAuth();
  const [logins, setLogins] = React.useState<AccessUser[] | null>(null);

  React.useEffect(() => {
    if (!enabled || !user) return;
    const allowed = assignableRoles(user);
    accessApi
      .listUsers()
      .then((users) => setLogins(users.filter((u) => !u.employee && allowed.includes(u.role))))
      .catch(() => setLogins([]));
  }, [enabled, user]);

  return logins;
}
