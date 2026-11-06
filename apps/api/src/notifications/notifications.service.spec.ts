import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

function row(overrides: Record<string, any> = {}) {
  return {
    id: 'log-1',
    tenantId: 'tenant-1',
    template: 'DOCUMENT_BLOCKED',
    recipientUserId: 'u-1',
    recipientEmail: 'asha@acme.test',
    context: { documentLabel: 'id.pdf' },
    dedupeKey: 'k',
    status: 'FAILED',
    attempts: 5,
    lastError: 'Email sending is not configured',
    providerMessageId: null,
    createdAt: new Date(),
    sentAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

function build() {
  const client = {
    notificationLog: {
      findMany: jest.fn().mockResolvedValue([row()]),
      groupBy: jest.fn().mockResolvedValue([
        { status: 'FAILED', _count: { _all: 2 } },
        { status: 'SENT', _count: { _all: 7 } },
      ]),
      findUnique: jest.fn().mockResolvedValue(row()),
      update: jest.fn((args: any) => row(args.data)),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const dispatcher = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const config = { get: () => 'https://hrms.example' };
  const service = new NotificationsService(
    { tenantId: 'tenant-1', client } as any,
    dispatcher as any,
    config as any,
  );
  return { service, client, dispatcher };
}

const actor = { sub: 'u-hr', tenantId: 'tenant-1', role: 'HR_MANAGER', email: 'hr@acme.test' };

describe('NotificationsService.list', () => {
  it('returns per-status counts and items with a rendered subject, not the raw context', async () => {
    const { service } = build();
    const result = await service.list({});
    expect(result.counts).toEqual({ QUEUED: 0, SENT: 7, FAILED: 2 });
    expect(result.items[0]).toMatchObject({
      id: 'log-1',
      subject: 'A file you uploaded was blocked: id.pdf',
      status: 'FAILED',
      recipientEmail: 'asha@acme.test',
    });
    expect(result.items[0]).not.toHaveProperty('context');
  });

  it('filters by a known status, ignores an unknown one, and caps the limit', async () => {
    const { service, client } = build();
    await service.list({ status: 'FAILED', limit: '5000' });
    expect(client.notificationLog.findMany).toHaveBeenLastCalledWith({
      where: { status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    await service.list({ status: 'DROP TABLE', limit: 'abc' });
    expect(client.notificationLog.findMany).toHaveBeenLastCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });
});

describe('NotificationsService.retry', () => {
  it('re-queues a FAILED email, audits it, and enqueues the send', async () => {
    const { service, client, dispatcher } = build();
    const dto = await service.retry('log-1', actor);
    expect(client.notificationLog.update).toHaveBeenCalledWith({
      where: { id: 'log-1' },
      data: { status: 'QUEUED' },
    });
    expect(client.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'notifications.retried',
        actorUserId: 'u-hr',
        targetId: 'log-1',
      }),
    });
    expect(dispatcher.enqueue).toHaveBeenCalledWith('tenant-1', 'log-1');
    expect(dto.status).toBe('QUEUED');
  });

  it.each(['SENT', 'QUEUED'])(
    'refuses to retry a %s email (never double-sends)',
    async (status) => {
      const { service, client, dispatcher } = build();
      client.notificationLog.findUnique.mockResolvedValue(row({ status }));
      await expect(service.retry('log-1', actor)).rejects.toBeInstanceOf(BadRequestException);
      expect(client.notificationLog.update).not.toHaveBeenCalled();
      expect(dispatcher.enqueue).not.toHaveBeenCalled();
    },
  );

  it("404s for an id RLS can't see (another tenant's row)", async () => {
    const { service, client } = build();
    client.notificationLog.findUnique.mockResolvedValue(null);
    await expect(service.retry('log-x', actor)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('still succeeds if Redis is down — the sweep sends the QUEUED row later', async () => {
    const { service, dispatcher } = build();
    dispatcher.enqueue.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(service.retry('log-1', actor)).resolves.toMatchObject({ status: 'QUEUED' });
  });
});
