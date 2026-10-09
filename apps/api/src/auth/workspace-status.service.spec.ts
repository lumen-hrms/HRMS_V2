import { WorkspaceStatusService } from './workspace-status.service';

const trial = new Date('2026-10-12T00:00:00Z');
const grace = new Date('2026-10-20T00:00:00Z');

function svc(tenant: unknown) {
  const prisma = { tenant: { findUnique: jest.fn().mockResolvedValue(tenant) } };
  return { service: new WorkspaceStatusService(prisma as any), prisma };
}

describe('WorkspaceStatusService', () => {
  it('returns the trial end only while on trial', async () => {
    const { service, prisma } = svc({
      status: 'TRIAL',
      subscription: { trialEndsAt: trial, graceEndsAt: grace },
    });
    expect(await service.get('t1')).toEqual({
      status: 'TRIAL',
      trialEndsAt: trial.toISOString(),
      graceEndsAt: null,
    });
    expect(prisma.tenant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' } }),
    );
  });

  it('returns the grace end only while ACTIVE', async () => {
    const { service } = svc({
      status: 'ACTIVE',
      subscription: { trialEndsAt: null, graceEndsAt: grace },
    });
    expect(await service.get('t1')).toEqual({
      status: 'ACTIVE',
      trialEndsAt: null,
      graceEndsAt: grace.toISOString(),
    });
  });

  it('reports READ_ONLY with no dates', async () => {
    const { service } = svc({
      status: 'READ_ONLY',
      subscription: { trialEndsAt: trial, graceEndsAt: grace },
    });
    expect(await service.get('t1')).toEqual({
      status: 'READ_ONLY',
      trialEndsAt: null,
      graceEndsAt: null,
    });
  });
});
