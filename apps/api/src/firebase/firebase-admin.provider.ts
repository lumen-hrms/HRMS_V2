import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import type { AppConfig } from '../config/configuration';

/**
 * Single Firebase Admin SDK `Auth` instance, shared by every guard/service
 * that needs to verify ID tokens or manage users (createUser,
 * setCustomUserClaims). Firebase Auth *is* the IAM/session artifact for
 * this app now — there is no app-issued JWT to separately configure.
 *
 * Credential resolution:
 *   - `FIREBASE_SERVICE_ACCOUNT_JSON` (a full service-account JSON blob as a
 *     single env var) is used when present — the required path everywhere
 *     (local dev, CI, staging, production; there is no emulator anymore).
 *   - Otherwise falls back to Application Default Credentials (e.g. a
 *     workload-identity setup on the host).
 */
export const FIREBASE_AUTH = 'FIREBASE_AUTH';

export const firebaseAdminProvider: Provider = {
  provide: FIREBASE_AUTH,
  inject: [ConfigService],
  useFactory: (config: ConfigService<AppConfig, true>): admin.auth.Auth => {
    const projectId = config.get('firebase.projectId', { infer: true });
    const serviceAccountJson = config.get('firebase.serviceAccountJson', { infer: true });

    if (!admin.apps.length) {
      admin.initializeApp({
        projectId,
        credential: serviceAccountJson
          ? admin.credential.cert(JSON.parse(serviceAccountJson))
          : admin.credential.applicationDefault(),
      });
    }
    return admin.auth();
  },
};
