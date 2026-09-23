import { LeaveEscalationProcessor } from './leave-escalation.processor';

jest.mock('../prisma/with-tenant-context', () => ({
  withTenantContext: (raw: any, tenantId: string) => raw.forTenant(tenantId),
}));

function build(request: Record<string, any> | null) {
  const client = {
    leaveRequest: {
      findUnique: jest.fn().mockResolvedValue(
        request && {
          id: 'req-1',
          startDate: new Date('2026-01-05'),
          endDate: new Date('2026-01-06'),
          days: 2,
          reason: null,
          employee: { firstName: 'Asha', lastName: 'Rao' },
          leaveType: { name: 'Sick' },
          ...request,
        },
      ),
      update: jest.fn(),
    },
    leaveApproval: { create: jest.fn() },
    tenantSettings: { findUniqueOrThrow: jest.fn().mockResolvedValue({ leaveEscalationDays: 3 }) },
  };
  const raw = { forTenant: jest.fn(() => client) };
  const queue = { add: jest.fn() };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const processor = new LeaveEscalationProcessor(raw as any, queue as any, notifications as any);
  return { processor, client, queue, notifications };
}

const job = (level: 1 | 2) =>
  ({ name: 'escalate', data: { tenantId: 'tenant-1', leaveRequestId: 'req-1', level } }) as any;

describe('LeaveEscalationProcessor', () => {
  it('L1 timeout → moves to PENDING_L2, re-arms for L2, and emails HR as escalated', async () => {
    const { processor, client, queue, notifications } = build({ status: 'PENDING_L1' });
    await processor.process(job(1));

    expect(client.leaveRequest.update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: { status: 'PENDING_L2' },
    });
    expect(queue.add).toHaveBeenCalledWith(
      'escalate',
      { tenantId: 'tenant-1', leaveRequestId: 'req-1', level: 2 },
      expect.objectContaining({ jobId: 'escalate:req-1:2' }),
    );
    expect(notifications.notify).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      template: 'LEAVE_PENDING_APPROVAL',
      context: expect.objectContaining({ applicantName: 'Asha Rao', level: 2, escalated: true }),
      // Same key as a manual L1 approval, so HR is emailed once either way.
      dedupeKey: 'leave:req-1:pending:L2',
      to: { roles: ['COMPANY_ADMIN', 'HR_MANAGER'] },
    });
  });

  it('L2 timeout → flags it in the trail and emails HR an overdue reminder', async () => {
    const { processor, client, notifications } = build({ status: 'PENDING_L2' });
    await processor.process(job(2));
    expect(client.leaveApproval.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ level: 2, decision: 'ESCALATED' }),
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'LEAVE_ESCALATED',
        dedupeKey: 'leave:req-1:escalated:L2',
        to: { roles: ['COMPANY_ADMIN', 'HR_MANAGER'] },
      }),
    );
  });

  it.each([
    ['decided since', { status: 'APPROVED' }, 1],
    ['moved past L1 already', { status: 'PENDING_L2' }, 1],
  ])('no-ops (no email) when the request was %s', async (_name, request, level) => {
    const { processor, client, notifications } = build(request);
    await processor.process(job(level as 1 | 2));
    expect(client.leaveRequest.update).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('no-ops when the request no longer exists', async () => {
    const { processor, notifications } = build(null);
    await processor.process(job(1));
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
