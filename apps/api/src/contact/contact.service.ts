import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { PlatformPrismaClientProvider } from '../prisma/platform-prisma-client.provider';
import { SesEmailSender } from '../notifications/ses-email.sender';
import { WindowLimiter } from '../auth/password-reset.service';
import { renderContactNotifyEmail } from './contact-email';
import type { CreateContactSubmissionDto } from './dto/contact.dto';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_EMAIL = 3;
const MAX_PER_IP = 10;

/** Same fixed-window-in-memory shape as `PasswordResetLimiter` — its own
 *  provider so it stays a singleton across requests. */
@Injectable()
export class ContactLimiter {
  readonly perEmail = new WindowLimiter(MAX_PER_EMAIL, WINDOW_MS);
  readonly perIp = new WindowLimiter(MAX_PER_IP, WINDOW_MS);
}

/**
 * The public "Contact us" form (landing page, pre-tenant, no auth). Every
 * submission is stored first — a lead must never be lost just because SES
 * is unreachable — then a best-effort notification goes out to whichever
 * addresses the operator has configured in `platform.platform_settings`
 * (Platform Admin → Settings). No recipients configured is not an error;
 * it just means nobody gets emailed until an operator sets the list, and
 * the submission still shows up in Platform Admin → Leads.
 */
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly platformPrisma: PlatformPrismaClientProvider,
    private readonly sesSender: SesEmailSender,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly limiter: ContactLimiter,
  ) {}

  async submit(dto: CreateContactSubmissionDto, ip: string | undefined): Promise<void> {
    if (!this.limiter.perIp.take(ip ?? 'unknown')) {
      throw new HttpException(
        'Too many submissions. Please wait a few minutes and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const email = dto.email.trim().toLowerCase();
    if (!this.limiter.perEmail.take(email)) {
      throw new HttpException(
        'Too many submissions from this email. Please wait a few minutes and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.platformPrisma.contactSubmission.create({
      data: {
        name: dto.name,
        email,
        company: dto.company || null,
        phone: dto.phone || null,
        message: dto.message,
        ipAddress: ip ?? null,
      },
    });

    await this.notifyRecipients({ ...dto, email });
  }

  private async notifyRecipients(dto: CreateContactSubmissionDto): Promise<void> {
    if (!this.sesSender.isConfigured) {
      this.logger.warn('Contact form submitted but SES is not configured — no notification sent');
      return;
    }

    const settings = await this.platformPrisma.platformSettings.findUnique({
      where: { id: 'singleton' },
      select: { contactNotifyEmails: true },
    });
    const recipients = settings?.contactNotifyEmails ?? [];
    if (recipients.length === 0) {
      this.logger.warn('Contact form submitted but no notify recipients are configured');
      return;
    }

    const rendered = renderContactNotifyEmail({
      ...dto,
      appBaseUrl: this.config.get('appBaseUrl', { infer: true }),
    });

    await Promise.all(
      recipients.map(async (to) => {
        try {
          await this.sesSender.send({ ...rendered, to, fromName: 'Lumen HRMS Website' });
        } catch (err) {
          this.logger.error(
            `Contact-form notify to ${to} failed`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      }),
    );
  }
}
