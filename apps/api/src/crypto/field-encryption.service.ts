import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { AppConfig } from '../config/configuration';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const VERSION_PREFIX = 'v1';

/**
 * Application-layer field encryption for PII (PAN, bank account —
 * CLAUDE.md's security non-negotiable: "a raw DB dump alone should not be
 * enough to read them"). AES-256-GCM with a data key from
 * `FIELD_ENCRYPTION_KEY` (base64, 32 bytes).
 *
 * This is the "KMS data key" half of the envelope today — the key itself is
 * a static secret in the team vault, same tier as the DB/Firebase
 * credentials, not yet wrapped by a real AWS KMS master key (that lands with
 * the production AWS migration per CLAUDE.md's Stack table). Callers never
 * see this distinction — `encrypt`/`decrypt` is the whole interface, so
 * swapping the key source later touches only this file.
 *
 * Ciphertext format: `v1:<iv-base64>:<authTag-base64>:<ciphertext-base64>` —
 * versioned so a future key-rotation or algorithm change can branch on the
 * prefix instead of guessing.
 */
@Injectable()
export class FieldEncryptionService {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  /**
   * Resolved lazily (not in the constructor) so a tenant with no
   * FIELD_ENCRYPTION_KEY configured yet can still boot the API and use
   * every other feature — only an actual PAN/bank-account write or reveal
   * fails, with a clear message, instead of the whole process refusing to
   * start.
   */
  private getKey(): Buffer {
    const base64 = this.config.get('encryption', { infer: true }).fieldKeyBase64;
    if (!base64) {
      throw new InternalServerErrorException(
        'FIELD_ENCRYPTION_KEY is not configured — required to store or reveal PAN/bank account data.',
      );
    }
    const key = Buffer.from(base64, 'base64');
    if (key.length !== 32) {
      throw new InternalServerErrorException(
        'FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).',
      );
    }
    return key;
  }

  encrypt(plaintext: string): string {
    const key = this.getKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [
      VERSION_PREFIX,
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(stored: string): string {
    const parts = stored.split(':');
    if (parts.length !== 4 || parts[0] !== VERSION_PREFIX) {
      throw new InternalServerErrorException('Unrecognized ciphertext format.');
    }
    const [, ivB64, authTagB64, ciphertextB64] = parts;
    const decipher = createDecipheriv(ALGORITHM, this.getKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}

/** `ABCDEF1234G` -> `ABCDE****G` (India PAN: 5 letters, 4 digits, 1 letter). */
export function maskPan(pan: string): string {
  if (pan.length < 6) return '*'.repeat(pan.length);
  return `${pan.slice(0, 5)}${'*'.repeat(pan.length - 6)}${pan.slice(-1)}`;
}

/** `123456781234` -> `••••1234` — last 4 digits only, however long the account number. */
export function maskBankAccount(accountNumber: string): string {
  const last4 = accountNumber.slice(-4);
  return `••••${last4}`;
}
