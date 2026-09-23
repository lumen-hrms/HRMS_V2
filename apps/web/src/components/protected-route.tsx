import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/auth-context';
import { LandingPage } from '@/pages/landing';

/**
 * Signed-out visitors to the site root get the public landing page instead
 * of a bounce to /login; every other protected URL still redirects. Signed-in
 * users see the dashboard at `/` exactly as before.
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  if (loading) {
    return <div className="flex h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }
  if (!user) return pathname === '/' ? <LandingPage /> : <Navigate to="/login" replace />;
  return <>{children}</>;
}
