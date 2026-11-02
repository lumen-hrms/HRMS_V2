import { Injectable } from '@nestjs/common';
import { createVerify } from 'crypto';

/** The JSON envelope SNS POSTs to an HTTPS subscription. */
export interface SnsMessage {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
}

const REQUIRED = [
  'Type',
  'MessageId',
  'TopicArn',
  'Message',
  'Timestamp',
  'SignatureVersion',
  'Signature',
  'SigningCertURL',
] as const;

/** SNS sends `text/plain`, so the body may arrive as a string, a Buffer or (if
 *  someone set a JSON content type) an already-parsed object. */
export function parseSnsMessage(body: unknown): SnsMessage | null {
  let value: unknown = body;
  try {
    if (Buffer.isBuffer(value)) value = value.toString('utf8');
    if (typeof value === 'string') value = JSON.parse(value);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const msg = value as Record<string, unknown>;
  return REQUIRED.every((k) => typeof msg[k] === 'string') ? (msg as unknown as SnsMessage) : null;
}

/** True only for an `https://sns.<region>.amazonaws.com/...` URL — the cert
 *  and SubscribeURL must never point anywhere an attacker controls. */
export function isSnsUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname);
  } catch {
    return false;
  }
}

/** AWS's canonical string-to-sign: `Key\nValue\n` for a fixed, sorted key
 *  list per message type, skipping keys the message doesn't carry. */
export function stringToSign(msg: SnsMessage): string {
  const keys: (keyof SnsMessage)[] =
    msg.Type === 'Notification'
      ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
      : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  return keys
    .filter((k) => msg[k] !== undefined)
    .map((k) => `${k}\n${msg[k]}\n`)
    .join('');
}

/**
 * Verifies an SNS message signature against the AWS signing certificate
 * (https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html).
 * Certificates are cached per URL for the life of the process.
 */
@Injectable()
export class SnsMessageVerifier {
  private readonly certs = new Map<string, string>();

  async verify(msg: SnsMessage): Promise<boolean> {
    const algorithm =
      msg.SignatureVersion === '1'
        ? 'RSA-SHA1'
        : msg.SignatureVersion === '2'
          ? 'RSA-SHA256'
          : null;
    if (!algorithm) return false;
    if (!isSnsUrl(msg.SigningCertURL) || !new URL(msg.SigningCertURL).pathname.endsWith('.pem')) {
      return false;
    }
    let cert = this.certs.get(msg.SigningCertURL);
    if (!cert) {
      cert = await this.fetchText(msg.SigningCertURL);
      this.certs.set(msg.SigningCertURL, cert);
    }
    try {
      return createVerify(algorithm)
        .update(stringToSign(msg), 'utf8')
        .verify(cert, msg.Signature, 'base64');
    } catch {
      return false;
    }
  }

  /** GET an SNS URL (signing cert, SubscribeURL); throws on a non-2xx. */
  async fetchText(url: string): Promise<string> {
    if (!isSnsUrl(url)) throw new Error(`Refusing to fetch non-SNS URL ${url}`);
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
    return res.text();
  }
}
