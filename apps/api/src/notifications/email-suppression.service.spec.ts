import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  DeleteSuppressedDestinationCommand,
  NotFoundException as SesNotFoundException,
  SESv2Client,
} from '@aws-sdk/client-sesv2';
import { EmailSuppressionService } from './email-suppression.service';

jest.mock('../prisma/with-tenant-context', () => ({
  withTenantContext: (raw: any, tenantId: string) => raw.forTenant(tenantId),
}));

const TOPIC = 'arn:aws:sns:ap-south-1:123:ses-events';
const TENANT = '11111111-1111-4111-8111-111111111111';
const LOG = '22222222-2222-4222-8222-222222222222';

function build(topic: string | null = TOPIC) {
  const platform = {
    emailSuppression: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    platformAuditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const tenantClient = {
    notificationLog: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const raw = { forTenant: jest.fn(() => tenantClient) };
  const verifier = {
    verify: jest.fn().mockResolvedValue(true),
    fetchText: jest.fn().mockResolvedValue('ok'),
  };
  const config = { get: () => ({ region: 'ap-south-1', eventsTopicArn: topic ?? undefined }) };
  const service = new EmailSuppressionService(
    platform as any,
    raw as any,
    verifier as any,
    config as any,
  );
  return { service, platform, tenantClient, raw, verifier };
}

function sns(type: string, message: unknown, extra: Record<string, string> = {}) {
  return JSON.stringify({
    Type: type,
    MessageId: 'sns-1',
    TopicArn: TOPIC,
    Message: typeof message === 'string' ? message : JSON.stringify(message),
    Timestamp: '2026-11-02T10:00:00Z',
    SignatureVersion: '2',
    Signature: 'sig',
    SigningCertURL: 'https://sns.ap-south-1.amazonaws.com/c.pem',
    ...extra,
  });
}

const TAGS = { tenant_id: [TENANT], notification_id: [LOG], 'ses:from-domain': ['lumenhrms.work'] };

function bounce(bounceType: string, tags: Record<string, string[]> = TAGS) {
  return {
    eventType: 'Bounce',
    mail: { messageId: 'ses-msg-1', tags },
    bounce: {
      bounceType,
      bounceSubType: 'General',
      timestamp: '2026-11-02T09:59:00Z',
      bouncedRecipients: [
        { emailAddress: 'Asha@Acme.test', diagnosticCode: 'smtp; 550 5.1.1 user unknown' },
      ],
    },
  };
}

describe('EmailSuppressionService.handleSnsWebhook — authentication', () => {
  it('rejects everything when SES_EVENTS_TOPIC_ARN is unset', async () => {
    const { service } = build(null);
    await expect(service.handleSnsWebhook(sns('Notification', {}))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects a body that is not an SNS envelope', async () => {
    const { service } = build();
    await expect(service.handleSnsWebhook('{"hello":1}')).rejects.toThrow(BadRequestException);
  });

  it('rejects a message from another topic before checking its signature', async () => {
    const { service, verifier } = build();
    const body = sns('Notification', bounce('Permanent')).replace(TOPIC, 'arn:aws:sns:x:999:evil');
    await expect(service.handleSnsWebhook(body)).rejects.toThrow('Unexpected SNS topic');
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature and writes nothing', async () => {
    const { service, verifier, platform } = build();
    verifier.verify.mockResolvedValue(false);
    await expect(
      service.handleSnsWebhook(sns('Notification', bounce('Permanent'))),
    ).rejects.toThrow('Invalid SNS signature');
    expect(platform.emailSuppression.upsert).not.toHaveBeenCalled();
  });

  it('confirms a subscription by GETting its SubscribeURL', async () => {
    const { service, verifier } = build();
    const url = 'https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription&Token=t';
    await expect(
      service.handleSnsWebhook(
        sns('SubscriptionConfirmation', 'confirm', { SubscribeURL: url, Token: 't' }),
      ),
    ).resolves.toBe('subscribed');
    expect(verifier.fetchText).toHaveBeenCalledWith(url);
  });

  it('refuses a SubscribeURL off the SNS host', async () => {
    const { service, verifier } = build();
    const body = sns('SubscriptionConfirmation', 'confirm', {
      SubscribeURL: 'https://evil.example/confirm',
      Token: 't',
    });
    await expect(service.handleSnsWebhook(body)).rejects.toThrow(BadRequestException);
    expect(verifier.fetchText).not.toHaveBeenCalled();
  });

  it('ignores a notification whose Message is not JSON', async () => {
    const { service } = build();
    await expect(service.handleSnsWebhook(sns('Notification', 'plain text'))).resolves.toBe(
      'ignored',
    );
  });
});

describe('EmailSuppressionService.handleSesEvent', () => {
  it('a permanent bounce suppresses the (lower-cased) address and fails the tagged log row', async () => {
    const { service, platform, raw, tenantClient } = build();
    await expect(service.handleSesEvent(bounce('Permanent'))).resolves.toBe('bounce');

    expect(platform.emailSuppression.upsert).toHaveBeenCalledWith({
      where: { email: 'asha@acme.test' },
      create: {
        email: 'asha@acme.test',
        reason: 'BOUNCE',
        detail: 'General: smtp; 550 5.1.1 user unknown',
        lastEventAt: new Date('2026-11-02T09:59:00Z'),
      },
      update: expect.objectContaining({ reason: 'BOUNCE', eventCount: { increment: 1 } }),
    });
    expect(raw.forTenant).toHaveBeenCalledWith(TENANT);
    expect(tenantClient.notificationLog.updateMany).toHaveBeenCalledWith({
      where: { id: LOG, providerMessageId: 'ses-msg-1' },
      data: {
        status: 'FAILED',
        lastError: expect.stringMatching(/^Bounced \(permanent\) — General: smtp; 550.*suppressed/),
      },
    });
  });

  it('a transient bounce fails the row but does not suppress the address', async () => {
    const { service, platform, tenantClient } = build();
    await service.handleSesEvent(bounce('Transient'));
    expect(platform.emailSuppression.upsert).not.toHaveBeenCalled();
    expect(tenantClient.notificationLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'FAILED', lastError: expect.stringMatching(/^Bounced \(temporary\)/) },
      }),
    );
  });

  it('a complaint suppresses the address but leaves the delivered row SENT', async () => {
    const { service, platform, tenantClient } = build();
    await expect(
      service.handleSesEvent({
        notificationType: 'Complaint',
        mail: { messageId: 'ses-msg-1', tags: TAGS },
        complaint: {
          complaintFeedbackType: 'abuse',
          complainedRecipients: [{ emailAddress: 'ravi@acme.test' }],
        },
      }),
    ).resolves.toBe('complaint');
    expect(platform.emailSuppression.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          email: 'ravi@acme.test',
          reason: 'COMPLAINT',
          detail: 'abuse',
        }),
      }),
    );
    expect(tenantClient.notificationLog.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['no tags (auth / contact email)', {}],
    ['a non-uuid tenant tag', { tenant_id: ["x' OR 1=1"], notification_id: [LOG] }],
  ])('suppresses but touches no log row with %s', async (_label, tags) => {
    const { service, platform, raw } = build();
    await service.handleSesEvent(bounce('Permanent', tags));
    expect(platform.emailSuppression.upsert).toHaveBeenCalled();
    expect(raw.forTenant).not.toHaveBeenCalled();
  });

  it('ignores other event types (Delivery, Send, …)', async () => {
    const { service, platform } = build();
    await expect(service.handleSesEvent({ eventType: 'Delivery' })).resolves.toBe('ignored');
    expect(platform.emailSuppression.upsert).not.toHaveBeenCalled();
  });
});

describe('EmailSuppressionService.lift', () => {
  const ENTRY = {
    email: 'asha@acme.test',
    reason: 'BOUNCE',
    detail: 'General',
    eventCount: 2,
    lastEventAt: new Date(),
  };
  afterEach(() => jest.restoreAllMocks());

  it('404s for an address that is not suppressed', async () => {
    const { service } = build();
    await expect(service.lift('nobody@acme.test', 'ops@lumen.test')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('removes it from SES and our list, and audits it in one transaction', async () => {
    const send = jest.spyOn(SESv2Client.prototype, 'send').mockResolvedValue({} as never);
    const { service, platform } = build();
    platform.emailSuppression.findUnique.mockResolvedValue(ENTRY);

    await expect(service.lift(' Asha@Acme.test ', 'ops@lumen.test')).resolves.toEqual({
      email: 'asha@acme.test',
      sesListCleared: true,
    });
    const command = send.mock.calls[0][0] as DeleteSuppressedDestinationCommand;
    expect(command.input).toEqual({ EmailAddress: 'asha@acme.test' });
    expect(platform.$transaction).toHaveBeenCalledTimes(1);
    expect(platform.emailSuppression.delete).toHaveBeenCalledWith({
      where: { email: 'asha@acme.test' },
    });
    expect(platform.platformAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorEmail: 'ops@lumen.test',
        action: 'email_suppression.lifted',
        targetId: 'asha@acme.test',
        metadata: expect.objectContaining({ reason: 'BOUNCE', sesListCleared: true }),
      }),
    });
  });

  it('treats "not on the SES list" as cleared', async () => {
    jest
      .spyOn(SESv2Client.prototype, 'send')
      .mockRejectedValue(new SesNotFoundException({ message: 'nope', $metadata: {} }) as never);
    const { service, platform } = build();
    platform.emailSuppression.findUnique.mockResolvedValue(ENTRY);
    await expect(service.lift('asha@acme.test', 'ops@lumen.test')).resolves.toMatchObject({
      sesListCleared: true,
    });
  });

  it('still lifts ours, and reports it, when SES cannot be reached', async () => {
    jest.spyOn(SESv2Client.prototype, 'send').mockRejectedValue(new Error('AccessDenied') as never);
    const { service, platform } = build();
    platform.emailSuppression.findUnique.mockResolvedValue(ENTRY);
    await expect(service.lift('asha@acme.test', 'ops@lumen.test')).resolves.toMatchObject({
      sesListCleared: false,
    });
    expect(platform.emailSuppression.delete).toHaveBeenCalled();
  });
});
