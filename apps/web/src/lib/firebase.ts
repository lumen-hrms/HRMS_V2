/**
 * Firebase is the IAM/session provider for every user (tenant roles and
 * Platform Admin alike) — see CLAUDE.md's Auth stack row. `tenantId`/
 * `role` (or `type: 'platform_admin'`) live as custom claims on the ID
 * token, set server-side; this client only ever signs in and reads the
 * token back out.
 *
 * All config values come from Vite env vars (VITE_FIREBASE_*) — safe to
 * expose client-side, these are not secrets. Set them in apps/web/.env
 * (see .env.example) or your hosting provider's env config.
 */
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);

const emulatorHost = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST;
if (emulatorHost) {
  connectAuthEmulator(auth, `http://${emulatorHost}`, { disableWarnings: true });
}
