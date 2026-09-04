import * as React from 'react';
import { signInWithEmailAndPassword, signOut, onIdTokenChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { api, getTenantSubdomain, setTenantSubdomain } from '@/lib/api';
export { isApiError } from '@/lib/api';

export interface CurrentUser {
  sub: string;
  tenantId: string;
  role: 'COMPANY_ADMIN' | 'HR_MANAGER' | 'LINE_MANAGER' | 'EMPLOYEE' | 'AUDITOR';
  email: string;
  employeeId: string | null;
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  login: (subdomain: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<CurrentUser | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    // Fires on sign-in, sign-out, and Firebase's own silent token refresh —
    // this replaces the old mount-time refresh()+/auth/me restore. Every
    // firing re-confirms the session with the backend (checks isActive,
    // resolves employeeId) rather than trusting the token's claims alone.
    return onIdTokenChanged(auth, async (firebaseUser) => {
      if (!firebaseUser || !getTenantSubdomain()) {
        setUser(null);
        setLoading(false);
        return;
      }
      try {
        const idToken = await firebaseUser.getIdToken();
        const res = await api.post<{ status: string; user: CurrentUser }>('/auth/session', {
          idToken,
        });
        setUser(res.status === 'ok' ? res.user : null);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const login = React.useCallback(async (subdomain: string, email: string, password: string) => {
    setTenantSubdomain(subdomain);
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const idToken = await credential.user.getIdToken();
    const res = await api.post<{ status: string; user: CurrentUser }>('/auth/session', { idToken });
    if (res.status !== 'ok') {
      await signOut(auth);
      throw new Error('Session could not be established');
    }
    setUser(res.user);
  }, []);

  const logout = React.useCallback(async () => {
    await signOut(auth);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
