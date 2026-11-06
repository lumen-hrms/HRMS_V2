import { LeaveAccrualProcessor } from './leave-accrual.processor';
import * as withTenantContextModule from '../prisma/with-tenant-context';

jest.mock('../prisma/with-tenant-context');

function build(setupByTenant: Record<string, Date | null>) {
  (withTenantContextModule.withTenantContext as jest.Mock).mockImplementation(
    (_raw: unknown, tenantId: string) => ({
      tenantSetup: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            setupByTenant[tenantId] === undefined ? null : { completedAt: setupByTenant[tenantId] },
          ),
      },
    }),
  );
  const platformPrisma = {
    tenant: {
      findMany: jest.fn().mockResolvedValue(Object.keys(setupByTenant).map((id) => ({ id }))),
    },
  };
  const entitlement = {
    applyCarryForward: jest.fn().mockResolvedValue({}),
    applyPolicyDefaults: jest.fn().mockResolvedValue({}),
  };
  const processor = new LeaveAccrualProcessor(
    {} as any,
    platformPrisma as any,
    {} as any,
    entitlement as any,
  );
  return { processor, entitlement };
}

describe('LeaveAccrualProcessor', () => {
  it('runs carry-forward then policy defaults for set-up tenants only', async () => {
    const { processor, entitlement } = build({ done: new Date(), pending: null });
    const today = new Date('2026-11-01T01:00:00Z');

    await processor.runAccrual(today);

    expect(entitlement.applyCarryForward).toHaveBeenCalledTimes(1);
    expect(entitlement.applyPolicyDefaults).toHaveBeenCalledTimes(1);
    expect(entitlement.applyPolicyDefaults.mock.calls[0][1]).toBe('done');
  });

  it('keeps going when one tenant fails', async () => {
    const { processor, entitlement } = build({ a: new Date(), b: new Date() });
    entitlement.applyCarryForward.mockRejectedValueOnce(new Error('bad data'));

    await processor.runAccrual(new Date('2026-11-01T01:00:00Z'));

    expect(entitlement.applyPolicyDefaults).toHaveBeenCalledTimes(1);
    expect(entitlement.applyPolicyDefaults.mock.calls[0][1]).toBe('b');
  });
});
