import { HttpException } from '@nestjs/common';
import { ContactLimiter, ContactService } from './contact.service';
import type { CreateContactSubmissionDto } from './dto/contact.dto';

const DTO: CreateContactSubmissionDto = {
  name: 'Asha Rao',
  email: 'Asha@Acme.test',
  company: 'Acme Hospital',
  phone: '9999999999',
  message: 'We would like a demo of the HRMS platform.',
};

function build(
  overrides: { recipients?: string[]; sesConfigured?: boolean } = {},
  limiter = new ContactLimiter(),
) {
  const platformPrisma = {
    contactSubmission: { create: jest.fn().mockResolvedValue({ id: 'lead-1' }) },
    platformSettings: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ contactNotifyEmails: overrides.recipients ?? ['ops@lumenhrms.test'] }),
    },
  };
  const sesSender = {
    isConfigured: overrides.sesConfigured ?? true,
    send: jest.fn().mockResolvedValue('ses-message-id'),
  };
  const config = { get: jest.fn().mockReturnValue('https://app.lumenhrms.test') };
  const service = new ContactService(
    platformPrisma as any,
    sesSender as any,
    config as any,
    limiter,
  );
  return { service, platformPrisma, sesSender };
}

describe('ContactService.submit', () => {
  it('stores the submission before attempting to notify anyone', async () => {
    const { service, platformPrisma, sesSender } = build();
    await service.submit(DTO, '1.2.3.4');

    expect(platformPrisma.contactSubmission.create).toHaveBeenCalledWith({
      data: {
        name: 'Asha Rao',
        email: 'asha@acme.test',
        company: 'Acme Hospital',
        phone: '9999999999',
        message: 'We would like a demo of the HRMS platform.',
        ipAddress: '1.2.3.4',
      },
    });
    expect(sesSender.send).toHaveBeenCalledTimes(1);
    expect(sesSender.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ops@lumenhrms.test', fromName: 'Lumen HRMS Website' }),
    );
  });

  it('emails every configured recipient', async () => {
    const { service, sesSender } = build({ recipients: ['a@x.test', 'b@x.test'] });
    await service.submit(DTO, '1.2.3.4');
    expect(sesSender.send).toHaveBeenCalledTimes(2);
  });

  it('still stores the submission when no recipients are configured', async () => {
    const { service, platformPrisma, sesSender } = build({ recipients: [] });
    await expect(service.submit(DTO, '1.2.3.4')).resolves.toBeUndefined();
    expect(platformPrisma.contactSubmission.create).toHaveBeenCalled();
    expect(sesSender.send).not.toHaveBeenCalled();
  });

  it('still stores the submission when SES is not configured', async () => {
    const { service, platformPrisma, sesSender } = build({ sesConfigured: false });
    await expect(service.submit(DTO, '1.2.3.4')).resolves.toBeUndefined();
    expect(platformPrisma.contactSubmission.create).toHaveBeenCalled();
    expect(sesSender.send).not.toHaveBeenCalled();
  });

  it('swallows a failed send for one recipient without affecting others', async () => {
    const { service, sesSender } = build({ recipients: ['a@x.test', 'b@x.test'] });
    sesSender.send.mockRejectedValueOnce(new Error('SES down')).mockResolvedValueOnce('id-2');
    await expect(service.submit(DTO, '1.2.3.4')).resolves.toBeUndefined();
    expect(sesSender.send).toHaveBeenCalledTimes(2);
  });

  it('rejects the 4th submission from the same email within the window', async () => {
    const { service } = build();
    for (let i = 0; i < 3; i++) await service.submit(DTO, `10.0.0.${i}`);
    await expect(service.submit(DTO, '10.0.0.9')).rejects.toBeInstanceOf(HttpException);
  });

  it('rejects the 11th submission from the same IP within the window', async () => {
    const { service } = build();
    for (let i = 0; i < 10; i++) {
      await service.submit({ ...DTO, email: `person${i}@acme.test` }, '1.2.3.4');
    }
    await expect(
      service.submit({ ...DTO, email: 'person11@acme.test' }, '1.2.3.4'),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
