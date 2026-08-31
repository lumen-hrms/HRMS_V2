import * as React from 'react';
import { api, getTenantSubdomain, setAccessToken, setTenantSubdomain } from '@/lib/api';
export { isApiError } from '@/lib/api';

export interface CurrentUser {
  sub: string;
  tenantId: string;
  role: 'COMPANY_ADMIN' | 'HR_MANAGER' | 'LINE_MANAGER' | 'EMPLOYEE' | 'AUDITOR';
  email: string;
  employeeId: string | null;
}

interface LoginOutcome {
  status: 'ok' | 'mfa_required' | 'mfa_enrollment_required';
  mfaChallengeToken?: string;
  qrCodeDataUrl?: string;
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  login: (subdomain: string, email: string, password: string) => Promise<LoginOutcome>;
  verifyMfa: (challengeToken: string, code: string) => Promise<void>;
  completeMfaEnrollment: (challengeToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

function decodeJwt<T>(token: string): T {
  const payload = token.split('.')[1];
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(normalized));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<CurrentUser | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      if (getTenantSubdomain()) {
        const ok = await api.refresh();
        if (ok) {
          try {
            const me = await api.get<CurrentUser>('/auth/me');
            setUser(me);
          } catch {
            /* stale session, ignore */
          }
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = React.useCallback(async (subdomain: string, email: string, password: string) => {
    setTenantSubdomain(subdomain);
    const res = await api.post<{ status: string; accessToken?: string } & LoginOutcome>(
      '/auth/login',
      { email, password },
    );
    if (res.status === 'ok' && res.accessToken) {
      setAccessToken(res.accessToken);
      const me = await api.get<CurrentUser>('/auth/me');
      setUser(me);
    }
    return res as LoginOutcome;
  }, []);

  const verifyMfa = React.useCallback(async (challengeToken: string, code: string) => {
    const res = await api.post<{ accessToken: string }>('/auth/mfa/verify', {
      mfaChallengeToken: challengeToken,
      code,
    });
    setAccessToken(res.accessToken);
    const me = await api.get<CurrentUser>('/auth/me');
    setUser(me);
  }, []);

  const completeMfaEnrollment = React.useCallback(async (challengeToken: string, code: string) => {
    const res = await api.post<{ accessToken: string }>('/auth/mfa/enroll/verify', {
      mfaChallengeToken: challengeToken,
      code,
    });
    setAccessToken(res.accessToken);
    const me = await api.get<CurrentUser>('/auth/me');
    setUser(me);
  }, []);

  const logout = React.useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore */
    }
    setAccessToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, verifyMfa, completeMfaEnrollment, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export { decodeJwt };
