import { NotificationDispatcher } from './notification-dispatcher.service';

jest.mock('../prisma/with-tenant-context', () => ({
  withTenantContext: (raw: any, tenantId: string) => raw.forTenant(tenantId),
}));

const CONTEXT = {
  requestId: 'lr-1',
  applicantName: 'Asha Rao',
  leaveTypeName: 'Sick',
  startDate: '2026-10-01',
  endDate: '2026-10-02',
  days: 2,
  level: 1 as const,
};

function build() {
  const client = {
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'u-mgr', email: 'mgr@acme.test' },
        { id: 'u-actor', email: 'actor@acme.test' },
        { id: 'u-noemail', email: '' },
      ]),
    },
    notificationLog: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([{ id: 'log-1' }]),
    },
  };
  const raw = { forTenant: jest.fn(() => client) };
  const queue = { add: jest.fn().mockResolvedValue({}) };
  const dispatcher = new NotificationDispatcher(raw as any, queue as any);
  return { dispatcher, client, raw, queue };
}

describe('NotificationDispatcher.notify', () => {
  it('writes one QUEUED row per resolved recipient (deduped) and enqueues each', async () => {
    const { dispatcher, client, raw, queue } = build();

    await dispatcher.notify({
      tenantId: 'tenant-1',
      template: 'LEAVE_PENDING_APPROVAL',
      context: CONTEXT,
      dedupeKey: 'leave:lr-1:pending:L1',
      to: { employeeIds: ['emp-mgr'] },
      actorUserId: 'u-actor',
    });

    expect(raw.forTenant).toHaveBeenCalledWith('tenant-1');
    // RULE-3: skipDuplicates on the (tenant, dedupeKey, recipient) unique key.
    // RULE-4: actor excluded, email-less user skipped.
    expect(client.notificationLog.createMany).toHaveBeenCalledWith({
      data: [
        {
          tenantId: 'tenant-1',
          template: 'LEAVE_PENDING_APPROVAL',
          recipientUserId: 'u-mgr',
          recipientEmail: 'mgr@acme.test',
          context: CONTEXT,
          dedupeKey: 'leave:lr-1:pending:L1',
        },
      ],
      skipDuplicates: true,
    });
    expect(queue.add).toHaveBeenCalledWith(
      'send',
      { tenantId: 'tenant-1', logId: 'log-1' },
      expect.objectContaining({ jobId: 'notify-log-1', attempts: 5 }),
    );
  });

  it('resolves user ids, employee ids and roles in one active-users query', async () => {
    const { dispatcher, client } = build();
    await dispatcher.notify({
      tenantId: 'tenant-1',
      template: 'LEAVE_ESCALATED',
      context: CONTEXT,
      dedupeKey: 'k',
      to: { userIds: ['u-1', null], employeeIds: ['emp-1', undefined], roles: ['HR_MANAGER'] },
    });
    expect(client.user.findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        OR: [
          { id: { in: ['u-1'] } },
          { employee: { is: { id: { in: ['emp-1'] } } } },
          { role: { in: ['HR_MANAGER'] } },
        ],
      },
      select: { id: true, email: true },
    });
  });

  it('does nothing when there is nobody to notify (e.g. no reporting manager)', async () => {
    const { dispatcher, client, queue } = build();
    await dispatcher.notify({
      tenantId: 'tenant-1',
      template: 'LEAVE_PENDING_APPROVAL',
      context: CONTEXT,
      dedupeKey: 'k',
      to: { employeeIds: [null] },
    });
    expect(client.user.findMany).not.toHaveBeenCalled();
    expect(client.notificationLog.createMany).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('only enqueues rows still QUEUED — a replayed event re-sends nothing already sent', async () => {
    const { dispatcher, client, queue } = build();
    client.notificationLog.findMany.mockResolvedValue([]);
    await dispatcher.notify({
      tenantId: 'tenant-1',
      template: 'LEAVE_DECIDED',
      context: { ...CONTEXT, outcome: 'APPROVED' },
      dedupeKey: 'leave:lr-1:decided:APPROVED',
      to: { employeeIds: ['emp-1'] },
    });
    expect(client.notificationLog.findMany).toHaveBeenCalledWith({
      where: {
        dedupeKey: 'leave:lr-1:decided:APPROVED',
        status: 'QUEUED',
        recipientUserId: { in: ['u-mgr', 'u-actor'] },
      },
      select: { id: true },
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it.each([
    [
      'the database write',
      (c: any) => c.client.notificationLog.createMany.mockRejectedValue(new Error('db down')),
    ],
    ['the queue', (c: any) => c.queue.add.mockRejectedValue(new Error('ECONNREFUSED'))],
    ['recipient lookup', (c: any) => c.client.user.findMany.mockRejectedValue(new Error('boom'))],
  ])('never throws into the caller when %s fails (RULE-2)', async (_name, breakIt) => {
    const built = build();
    breakIt(built);
    await expect(
      built.dispatcher.notify({
        tenantId: 'tenant-1',
        template: 'LEAVE_PENDING_APPROVAL',
        context: CONTEXT,
        dedupeKey: 'k',
        to: { employeeIds: ['emp-mgr'] },
      }),
    ).resolves.toBeUndefined();
  });
});
