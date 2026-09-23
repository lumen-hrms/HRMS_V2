import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { formatFrom, SesEmailSender } from './ses-email.sender';

function senderWith(ses: Record<string, unknown>) {
  const config = { get: () => ({ region: 'ap-south-1', ...ses }) };
  return new SesEmailSender(config as any);
}

const EMAIL = {
  to: 'asha@acme.test',
  fromName: 'Acme Hospital via Lumen HRMS',
  subject: 'Hello',
  text: 'plain',
  html: '<p>html</p>',
};

describe('SesEmailSender', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends one SES v2 SendEmail with text + html bodies and returns the MessageId', async () => {
    const send = jest
      .spyOn(SESv2Client.prototype, 'send')
      .mockResolvedValue({ MessageId: 'msg-1' } as never);
    const sender = senderWith({ fromAddress: 'no-reply@lumen.test', configurationSet: 'hrms' });

    await expect(sender.send(EMAIL)).resolves.toBe('msg-1');

    const command = send.mock.calls[0][0] as SendEmailCommand;
    expect(command).toBeInstanceOf(SendEmailCommand);
    expect(command.input).toEqual({
      FromEmailAddress: '"Acme Hospital via Lumen HRMS" <no-reply@lumen.test>',
      Destination: { ToAddresses: ['asha@acme.test'] },
      ConfigurationSetName: 'hrms',
      Content: {
        Simple: {
          Subject: { Data: 'Hello', Charset: 'UTF-8' },
          Body: {
            Text: { Data: 'plain', Charset: 'UTF-8' },
            Html: { Data: '<p>html</p>', Charset: 'UTF-8' },
          },
        },
      },
    });
  });

  it('refuses to send when SES_FROM_ADDRESS is unset — surfaces as FAILED, never silently skipped', async () => {
    const send = jest.spyOn(SESv2Client.prototype, 'send');
    await expect(senderWith({}).send(EMAIL)).rejects.toThrow(/SES_FROM_ADDRESS is unset/);
    expect(send).not.toHaveBeenCalled();
  });

  it('treats a response without a MessageId as a failure', async () => {
    jest.spyOn(SESv2Client.prototype, 'send').mockResolvedValue({} as never);
    await expect(senderWith({ fromAddress: 'a@b.test' }).send(EMAIL)).rejects.toThrow(
      /no MessageId/,
    );
  });
});

describe('formatFrom', () => {
  it('quotes an ASCII display name and strips quotes/newlines', () => {
    expect(formatFrom('Acme "HQ"\r\n', 'a@b.test')).toBe('"Acme HQ" <a@b.test>');
  });

  it('RFC 2047-encodes a non-ASCII display name', () => {
    const from = formatFrom('Café Clinic', 'a@b.test');
    expect(from).toBe(`=?UTF-8?B?${Buffer.from('Café Clinic').toString('base64')}?= <a@b.test>`);
  });

  it('falls back to the bare address for an empty name', () => {
    expect(formatFrom('  ', 'a@b.test')).toBe('a@b.test');
  });
});
