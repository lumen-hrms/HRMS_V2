import { isApiError } from '@/lib/api';

/** `login()`/`handleLogin()` can throw either a raw Firebase Auth error
 * (rejected before the request ever reaches the backend, e.g. wrong
 * password) or an ApiError from the `/auth/session` exchange (e.g. the
 * account is deactivated). Map both into one clear message for the error
 * banner — shared so the tenant and Platform Admin screens don't drift. */
export function describeLoginError(err: unknown): string {
  if (isApiError(err)) return err.message;

  const code = (err as { code?: string } | undefined)?.code;
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password. Please try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact your administrator.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'Network error — check your connection and try again.';
    default:
      return 'Login failed. Please try again.';
  }
}
