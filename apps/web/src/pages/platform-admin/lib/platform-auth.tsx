import * as React from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export interface PlatformAdmin {
  sub: string;
  email: string;
}

interface PlatformAuthValue {
  admin: PlatformAdmin;
  logout: () => Promise<void>;
}

const PlatformAuthContext = React.createContext<PlatformAuthValue | null>(null);

export function PlatformAuthProvider({
  admin,
  onLoggedOut,
  children,
}: {
  admin: PlatformAdmin;
  onLoggedOut: () => void;
  children: React.ReactNode;
}) {
  const logout = React.useCallback(async () => {
    await signOut(auth).catch(() => undefined);
    onLoggedOut();
  }, [onLoggedOut]);

  return (
    <PlatformAuthContext.Provider value={{ admin, logout }}>{children}</PlatformAuthContext.Provider>
  );
}

export function usePlatformAuth(): PlatformAuthValue {
  const ctx = React.useContext(PlatformAuthContext);
  if (!ctx) throw new Error('usePlatformAuth must be used within PlatformAuthProvider');
  return ctx;
}
