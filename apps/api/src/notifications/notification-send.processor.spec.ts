import { NotificationSendProcessor } from './notification-send.processor';

jest.mock('../prisma/with-tenant-context', () => ({
  withTenantContext: (raw: any, tenantId: string) => raw.forTenant(tenantId),
}));

function logRow(overrides: Record<string, any> = {}) {
  return {
    id: 'log-1',
    tenantId: 'tenant-1',
    template: 'DOCUMENT_BLOCKED',
    recipientUserId: 'u-1',
    recipientEmail: 'asha@acme.test',
    context: { documentLabel: 'id.pdf' },
    dedupeKey: 'document:d-1:blocked',
    status: 'QUEUED',
    attempts: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

function build() {
  const client = {
    notificationLog: {
      findUnique: jest.fn().mockResolvedValue(logRow()),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const raw = { forTenant: jest.fn(() => client) };
  const platform = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ name: 'Acme Hospital' }),
      findMany: jest.fn().mockResolvedValue([{ id: 'tenant-1' }, { id: 'tenant-2' }]),
    },
  };
  const queue = { add: jest.fn(), upsertJobScheduler: jest.fn() };
  const sender = { send: jest.fn().mockResolvedValue('ses-msg-1') };
  const config = { get: () => 'https://hrms.example' };
  const processor = new NotificationSendProcessor(
    queue as any,
    platform as any,
    raw as any,
    sender as any,
    config as any,
  );
  return { processor, client, raw, platform, queue, sender };
}

const JOB = { tenantId: 'tenant-1', logId: 'log-1' };

describe('NotificationSendProcessor.send', () => {
  it('renders, sends via SES under the tenant name, and marks SENT with the message id (RULE-5)', async () => {
    const { processor, client, raw, sender } = build();
    await processor.send(JOB, false);

    expect(raw.forTenant).toHaveBeenCalledWith('tenant-1');
    expect(sender.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'asha@acme.test',
        fromName: 'Acme Hospital via Lumen HRMS',
        subject: 'A file you uploaded was blocked: id.pdf',
      }),
    );
    expect(client.notificationLog.update).toHaveBeenCalledWith({
      where: { id: 'log-1' },
      data: {
        status: 'SENT',
        providerMessageId: 'ses-msg-1',
        sentAt: expect.any(Date),
        attempts: { increment: 1 },
        lastError: null,
      },
    });
  });

  it('records the error, keeps it QUEUED and rethrows so BullMQ retries', async () => {
    const { processor, client, sender } = build();
    sender.send.mockRejectedValue(new Error('Throttling'));
    await expect(processor.send(JOB, false)).rejects.toThrow('Throttling');
    expect(client.notificationLog.update).toHaveBeenCalledWith({
      where: { id: 'log-1' },
      data: { attempts: { increment: 1 }, lastError: 'Throttling' },
    });
  });

  it('marks FAILED on the final attempt (e.g. SES not configured)', async () => {
    const { processor, client, sender } = build();
    sender.send.mockRejectedValue(new Error('Email sending is not configured'));
    await expect(processor.send(JOB, true)).rejects.toThrow();
    expect(client.notificationLog.update).toHaveBeenCalledWith({
      where: { id: 'log-1' },
      data: {
        attempts: { increment: 1 },
        lastError: 'Email sending is not configured',
        status: 'FAILED',
      },
    });
  });

  it.each(['SENT', 'FAILED'])('never re-sends a %s row', async (status) => {
    const { processor, client, sender } = build();
    client.notificationLog.findUnique.mockResolvedValue(logRow({ status }));
    await processor.send(JOB, false);
    expect(sender.send).not.toHaveBeenCalled();
    expect(client.notificationLog.update).not.toHaveBeenCalled();
  });

  it('process() derives the final attempt from the job options', async () => {
    const { processor, client, sender } = build();
    sender.send.mockRejectedValue(new Error('boom'));
    await expect(
      processor.process({ name: 'send', data: JOB, attemptsMade: 4, opts: { attempts: 5 } } as any),
    ).rejects.toThrow('boom');
    expect(client.notificationLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
  });
});

describe('NotificationSendProcessor.sweep', () => {
  it('re-enqueues stale QUEUED rows in every tenant', async () => {
    const { processor, client, queue } = build();
    client.notificationLog.findMany
      .mockResolvedValueOnce([{ id: 'log-a' }])
      .mockResolvedValueOnce([{ id: 'log-b' }]);

    await processor.sweep(new Date('2026-09-23T10:00:00Z'));

    expect(client.notificationLog.findMany).toHaveBeenCalledWith({
      where: { status: 'QUEUED', createdAt: { lt: new Date('2026-09-23T09:50:00Z') } },
      select: { id: true },
    });
    expect(queue.add).toHaveBeenCalledWith(
      'send',
      { tenantId: 'tenant-1', logId: 'log-a' },
      expect.objectContaining({ jobId: 'notify-log-a', removeOnFail: true }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'send',
      { tenantId: 'tenant-2', logId: 'log-b' },
      expect.objectContaining({ jobId: 'notify-log-b' }),
    );
  });
});
