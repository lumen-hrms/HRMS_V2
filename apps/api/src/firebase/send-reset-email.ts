import { Logger, ServiceUnavailableException } from '@nestjs/common';

const logger = new Logger('FirebasePasswordReset');

/**
 * Sends Firebase's hosted password-reset email via the Identity Toolkit REST
 * endpoint. The Admin SDK can only *generate* a reset link, not send it — so
 * both the Identity & Access module (admin-triggered reset for another user)
 * and Platform Admin (first Company Admin onboarding) call this.
 *
 * `webApiKey` is the project's Web API key (not a secret; also in the web
 * client). Throws `ServiceUnavailableException` on any failure — callers
 * decide whether that's fatal.
 */
export async function sendFirebasePasswordResetEmail(
  webApiKey: string | undefined,
  email: string,
): Promise<void> {
  if (!webApiKey) {
    throw new ServiceUnavailableException(
      'FIREBASE_WEB_API_KEY is not configured — cannot send a hosted reset email.',
    );
  }

  let res: Response;
  try {
    res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(webApiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
      },
    );
  } catch (err) {
    throw new ServiceUnavailableException(
      `Could not reach the identity provider to send a reset email: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    logger.error(`accounts:sendOobCode failed (${res.status}) for ${email}: ${body}`);
    throw new ServiceUnavailableException(
      `The identity provider rejected the reset request (${res.status}).`,
    );
  }
}
