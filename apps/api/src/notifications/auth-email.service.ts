import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type * as admin from 'firebase-admin';
import type { AppConfig } from '../config/configuration';
import { FIREBASE_AUTH } from '../firebase/firebase-admin.provider';
import { PlatformPrismaClientProvider } from '../prisma/platform-prisma-client.provider';
import { sendFirebasePasswordResetEmail } from '../firebase/send-reset-email';
import { SesEmailSender } from './ses-email.sender';
import { renderEmail, type EmailBody } from './templates';

/**
 * Why the reset link is being sent — changes only the wording:
 * - `INVITE`  first Company Admin of a newly onboarded workspace
 * - `ADMIN_RESET`  an admin reset someone else's password
 * - `SELF_SERVICE`  the user asked for it ("Forgot password?" / My Account)
 */
export type AuthEmailKind = 'INVITE' | 'ADMIN_RESET' | 'SELF_SERVICE';

export interface PasswordResetEmail {
  email: string;
  kind: AuthEmailKind;
  /** Workspace the account belongs to — its display name goes in the From line and copy. */
  tenantId: string;
  /** Who the email is addressed to — used by `ADMIN_RESET` to greet them by name. */
  recipientName?: string;
}

/** Which path actually delivered the email — surfaced for logs/tests. */
export type AuthEmailChannel = 'ses' | 'firebase';

export function authEmailBody(
  kind: AuthEmailKind,
  tenantName: string,
  link: string,
  recipientName?: string,
): EmailBody {
  switch (kind) {
    case 'INVITE':
      return {
        subject: `You're invited to ${tenantName} on Lumen HRMS`,
        intro: `Your company workspace "${tenantName}" is ready on Lumen HRMS, and you've been set up as its Company Admin. Choose a password to sign in for the first time.`,
        rows: [],
        outro:
          'This link expires after a while for security. If it has, use "Forgot password?" on the sign-in page to get a new one.',
        cta: { label: 'Set your password', path: link },
      };
    case 'ADMIN_RESET':
      return {
        subject: `Reset your ${tenantName} password`,
        intro: `${recipientName ? `Hi ${recipientName}, your` : 'Your'} HR team at ${tenantName} has requested a password reset for your Lumen HRMS account. Use the button below to set a new password.`,
        rows: [
          ...(recipientName ? [['Name', recipientName] as [string, string]] : []),
          ['Company', tenantName],
        ],
        outro: `If you weren't expecting this, contact your HR team at ${tenantName} — your current password stops working once you set a new one.`,
        cta: { label: 'Set a new password', path: link },
      };
    case 'SELF_SERVICE':
      return {
        subject: `Reset your ${tenantName} password`,
        intro: 'We received a request to reset the password for your Lumen HRMS account.',
        rows: [],
        outro:
          "If you didn't ask for this, you can ignore this email — your password won't change.",
        cta: { label: 'Reset password', path: link },
      };
  }
}

export interface LoginCredentialsEmail {
  email: string;
  tenantId: string;
  employeeCode: string;
  tempPassword: string;
  recipientName?: string;
}

export function loginCredentialsBody(
  tenantName: string,
  employeeCode: string,
  email: string,
  tempPassword: string,
  recipientName?: string,
): EmailBody {
  return {
    subject: `Your ${tenantName} sign-in details`,
    intro: `${recipientName ? `Hi ${recipientName}, your` : 'Your'} HR team at ${tenantName} has created a Lumen HRMS login for you. Use the details below to sign in.`,
    rows: [
      ['Company', tenantName],
      ['Employee ID', employeeCode],
      ['Username (sign in with this email)', email],
      ['Temporary password', tempPassword],
    ],
    outro:
      'For your security, set your own password after signing in for the first time — use "Forgot password?" on the sign-in page.',
    cta: { label: 'Sign in', path: '/login' },
  };
}

/**
 * Password-reset / workspace-invite emails, branded and sent from the
 * company's own domain via SES (module 10).
 *
 * Firebase still owns the password itself: the Admin SDK generates the
 * one-time reset link and Firebase's hosted page handles it — we only
 * replace *who sends the email*. Sent synchronously (callers report
 * success/failure to the operator/admin in the same request) and never
 * written to `notification_log`: the link is a live credential.
 *
 * If SES isn't configured (e.g. a teammate's laptop), falls back to
 * Firebase's own reset email so the flow keeps working.
 */
@Injectable()
export class AuthEmailService {
  private readonly logger = new Logger(AuthEmailService.name);
  private readonly appBaseUrl: string;

  constructor(
    private readonly sender: SesEmailSender,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(FIREBASE_AUTH) private readonly firebaseAuth: admin.auth.Auth,
    private readonly platformPrisma: PlatformPrismaClientProvider,
  ) {
    this.appBaseUrl = config.get('appBaseUrl', { infer: true });
  }

  /** Throws if the email couldn't be sent by either path. */
  async sendPasswordReset(input: PasswordResetEmail): Promise<AuthEmailChannel> {
    if (!this.sender.isConfigured) {
      await sendFirebasePasswordResetEmail(
        this.config.get('firebase.webApiKey', { infer: true }),
        input.email,
      );
      return 'firebase';
    }

    const tenant = await this.platformPrisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { name: true },
    });
    const tenantName = tenant?.name ?? 'Your company';
    const link = this.toAppLink(await this.generateLink(input.email));
    const email = renderEmail(authEmailBody(input.kind, tenantName, link, input.recipientName), {
      appBaseUrl: this.appBaseUrl,
      tenantName,
    });
    await this.sender.send({
      ...email,
      to: input.email,
      fromName: `${tenantName} via Lumen HRMS`,
    });
    return 'ses';
  }

  /**
   * Emails a new login's credentials (employee ID, sign-in email, temporary
   * password). Same rules as the reset link: sent synchronously, never
   * written to `notification_log` since it carries a live credential. There is
   * no Firebase fallback — Firebase can't send a custom password — so this
   * throws when SES isn't configured and the caller surfaces that.
   */
  async sendLoginCredentials(input: LoginCredentialsEmail): Promise<void> {
    if (!this.sender.isConfigured) {
      throw new Error('Email delivery (SES) is not configured');
    }
    const tenant = await this.platformPrisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { name: true },
    });
    const tenantName = tenant?.name ?? 'Your company';
    const email = renderEmail(
      loginCredentialsBody(
        tenantName,
        input.employeeCode,
        input.email,
        input.tempPassword,
        input.recipientName,
      ),
      { appBaseUrl: this.appBaseUrl, tenantName },
    );
    await this.sender.send({
      ...email,
      to: input.email,
      fromName: `${tenantName} via Lumen HRMS`,
    });
  }

  /**
   * Swaps Firebase's hosted (unstyled) reset page for our own `/auth/action`
   * page, keeping Firebase's one-time code — the page completes the reset
   * with the Firebase SDK, so it's the same flow in the Lumen shell.
   */
  private toAppLink(firebaseLink: string): string {
    const code = new URL(firebaseLink).searchParams.get('oobCode');
    if (!code) return firebaseLink;
    return `${this.appBaseUrl}/auth/action?mode=resetPassword&oobCode=${encodeURIComponent(code)}`;
  }

  /**
   * One-time Firebase reset link that returns to our sign-in page after the
   * password is set. The continue URL's domain must be in Firebase Auth's
   * *Authorized domains*; if it isn't, fall back to a plain link (the
   * reset still works, it just doesn't bounce back to /login).
   */
  private async generateLink(email: string): Promise<string> {
    try {
      return await this.firebaseAuth.generatePasswordResetLink(email, {
        url: `${this.appBaseUrl}/login`,
      });
    } catch (err: any) {
      if (
        err?.code === 'auth/unauthorized-continue-uri' ||
        err?.code === 'auth/invalid-continue-uri'
      ) {
        this.logger.warn(
          `${this.appBaseUrl} is not an authorized domain in Firebase Auth — sending a reset link without a return URL. Add it under Authentication → Settings → Authorized domains.`,
        );
        return this.firebaseAuth.generatePasswordResetLink(email);
      }
      throw err;
    }
  }
}
