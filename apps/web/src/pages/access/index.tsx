import * as React from 'react';
import { Navigate } from 'react-router-dom';
import { PageHeader } from '@/components/page-header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAuth } from '@/context/auth-context';
import {
  canChangeUserRole,
  canManageUsers,
  canReadAudit,
  canViewAccessModule,
  isReadOnly,
} from '@/lib/roles';
import { USE_MOCK } from '@/lib/access/client';
import { MockDataNote } from './shared';
import { UsersTab } from './tabs/users';
import { AuditTab } from './tabs/audit';

type TabId = 'users' | 'audit';

/**
 * Access management — `/access`. Company Admin & HR Manager (manage) and
 * Auditor (read-only) only; every other persona is bounced to their own
 * account view. See docs/modules/01_IDENTITY_AND_ACCESS.md §8.
 */
export function AccessPage() {
  const { user } = useAuth();
  const [active, setActive] = React.useState<TabId>('users');

  if (user && !canViewAccessModule(user)) return <Navigate to="/account" replace />;

  const readOnly = isReadOnly(user);
  const showAudit = canReadAudit(user);

  const tabs: { id: TabId; label: string }[] = [
    { id: 'users', label: 'Users' },
    ...(showAudit ? [{ id: 'audit' as const, label: 'Audit' }] : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Identity & Access"
        description="Logins, roles, and the sign-in / access-change audit trail."
        actions={USE_MOCK ? <MockDataNote /> : undefined}
      />

      <Tabs value={active} onValueChange={(v) => setActive(v as TabId)}>
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="users">
          <UsersTab
            readOnly={readOnly}
            canManage={!readOnly && canManageUsers(user)}
            canChangeRole={!readOnly && canChangeUserRole(user)}
          />
        </TabsContent>
        {showAudit && (
          <TabsContent value="audit">
            <AuditTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
