/**
 * Loads apps/api/.env.test into process.env BEFORE any test module is
 * imported. The e2e suite needs this early because test/utils/fixtures.ts
 * reads Firebase credentials (`FIREBASE_SERVICE_ACCOUNT_JSON`,
 * `FIREBASE_WEB_API_KEY`, `FIREBASE_PROJECT_ID`) and the DB URLs straight
 * from process.env at import time — Nest's ConfigModule (which also loads
 * .env.test for the app itself) runs too late for that. Real CI/shell
 * environments that already export these vars are unaffected: dotenv does
 * not override an existing value.
 */
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '..', '.env.test') });
