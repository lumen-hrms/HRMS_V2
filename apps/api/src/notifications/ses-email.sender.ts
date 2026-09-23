import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import type { AppConfig } from '../config/configuration';
import type { RenderedEmail } from './templates';

export interface OutgoingEmail extends RenderedEmail {
  to: string;
  /** Display name, e.g. "Acme Hospital via Lumen HRMS". */
  fromName: string;
}

/**
 * Accepts `SES_FROM_ADDRESS` as either `no-reply@x` or `Name <no-reply@x>`
 * and keeps just the address — the display name is always set per email
 * ("<Tenant> via Lumen HRMS"), so a second one would break the header.
 */
export function bareAddress(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const angled = /<([^<>\s]+@[^<>\s]+)>/.exec(value);
  const address = (angled ? angled[1] : value).trim();
  return address || undefined;
}

/**
 * RFC 5322 display name: quoted, with quotes/newlines stripped; non-ASCII
 * (a tenant named "Café …") goes out as an RFC 2047 encoded-word, which is
 * what SES expects in the From header.
 */
export function formatFrom(name: string, address: string): string {
  const clean = name.replace(/["\r\n\\]/g, '').trim();
  if (!clean) return address;
  // eslint-disable-next-line no-control-regex
  const display = /^[\x20-\x7e]*$/.test(clean)
    ? `"${clean}"`
    : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
  return `${display} <${address}>`;
}

/**
 * Module 10's only provider binding — AWS SES v2 (docs/modules/10_NOTIFICATIONS.md
 * §4.2). Credentials come from the AWS SDK default chain. Throws (so the
 * send job records FAILED and retries) when SES isn't configured.
 */
@Injectable()
export class SesEmailSender {
  private readonly client: SESv2Client;
  private readonly fromAddress?: string;
  private readonly configurationSet?: string;

  constructor(config: ConfigService<AppConfig, true>) {
    const ses = config.get('ses', { infer: true });
    this.client = new SESv2Client({ region: ses.region });
    this.fromAddress = bareAddress(ses.fromAddress);
    this.configurationSet = ses.configurationSet;
  }

  /** Returns SES's MessageId once SES has accepted the message. */
  async send(email: OutgoingEmail): Promise<string> {
    if (!this.fromAddress) {
      throw new Error('Email sending is not configured (SES_FROM_ADDRESS is unset)');
    }
    const res = await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: formatFrom(email.fromName, this.fromAddress),
        Destination: { ToAddresses: [email.to] },
        ConfigurationSetName: this.configurationSet,
        Content: {
          Simple: {
            Subject: { Data: email.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: email.text, Charset: 'UTF-8' },
              Html: { Data: email.html, Charset: 'UTF-8' },
            },
          },
        },
      }),
    );
    if (!res.MessageId) throw new Error('SES accepted the request but returned no MessageId');
    return res.MessageId;
  }
}
