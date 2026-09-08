import * as React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { auth } from '@/lib/firebase';
import { platformApi } from '@/lib/platform-api';
import { PlatformAuthProvider, type PlatformAdmin } from './lib/platform-auth';
import { PlatformAdminLogin } from './login';
import { PlatformShell } from './shell';
import { TenantsPage } from './tenants';
import { TenantNewPage } from './tenant-new';
import { TenantDetailPage } from './tenant-detail';
import { PlatformAuditPage } from './audit';

/**
 * Operator console — a separate React sub-tree, mounted at `/platform-admin/*`
 * OUTSIDE the tenant `AuthProvider`. Its own auth (Firebase + a
 * `type: platform_admin` token) and its own route table. Nothing here shares
 * tenant-app state.
 */
export function PlatformAdminConsole() {
  const [admin, setAdmin] = React.useState<PlatformAdmin | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Best-effort session restore on reload: if the Firebase SDK still holds a
  // user, re-confirm it's an operator token via POST /auth/session.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (idToken) {
          const res = await platformApi.session(idToken);
          if (!cancelled && res.status === 'ok') setAdmin(res.admin);
        }
      } catch {
        /* not signed in as an operator — show login */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!admin) {
    return <PlatformAdminLogin onAuthed={setAdmin} />;
  }

  return (
    <PlatformAuthProvider admin={admin} onLoggedOut={() => setAdmin(null)}>
      <Routes>
        <Route element={<PlatformShell />}>
          <Route index element={<TenantsPage />} />
          <Route path="tenants/new" element={<TenantNewPage />} />
          <Route path="tenants/:id" element={<TenantDetailPage />} />
          <Route path="audit" element={<PlatformAuditPage />} />
          <Route path="*" element={<Navigate to="/platform-admin" replace />} />
        </Route>
      </Routes>
    </PlatformAuthProvider>
  );
}
