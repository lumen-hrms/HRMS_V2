import { BadRequestException } from '@nestjs/common';
import { PlatformAdminService } from './platform-admin.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fake of the platform-role Prisma surface the trial lifecycle touches. */
function buildFakePlatformPrisma(opts: {
  tenant?: {
    status: string;
    subscription: { plan: string; trialEndsAt: Date | null } | null;
  } | null;
  expiredTenants?: Array<{ id: string; subscription: { trialEndsAt: Date } }>;
}) {
  const tenant = {
    findUnique: jest.fn().mockResolvedValue(opts.tenant ?? null),
    findMany: jest.fn().mockResolvedValue(opts.expiredTenants ?? []),
    update: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({ id: 'tenant-new', name: 'Acme', subdomain: 'acme' }),
    delete: jest.fn().mockResolvedValue({}),
  };
  const subscription = {
    update: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn(),
  };
  return {
    tenant,
    subscription,
    platformAuditLog: { create: jest.fn().mockResolvedValue({}) },
    // Each queued op is a promise already; Promise.all mirrors $transaction([...]).
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

function buildService(platformPrisma: ReturnType<typeof buildFakePlatformPrisma>) {
  const plans = {
    snapshotFor: jest.fn().mockResolvedValue({
      plan: 'GROWTH',
      seats: 50,
      enabledModules: ['CORE_HR', 'LEAVE'],
      features: {},
      pricePerSeat: { toFixed: () => '199.00' },
      isolationTier: 'POOLED',
    }),
  };
  const service = new PlatformAdminService(
    platformPrisma as any,
    {} as any,
    { get: jest.fn() } as any,
    plans as any,
    {} as any,
    {} as any,
  );
  return { service, plans };
}

const future = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();

describe('PlatformAdminService — trial lifecycle', () => {
  describe('createTenant trial window', () => {
    it('stores the chosen plan and a trial end 7 days out when no trialDays is given', async () => {
      const prisma = buildFakePlatformPrisma({});
      prisma.tenant.findUnique.mockResolvedValueOnce(null); // subdomain free
      const { service } = buildService(prisma);
      (service as any).seedCompanyAdmin = jest.fn().mockResolvedValue({ resetEmailSent: true });
      (service as any).seedTenantDefaults = jest.fn().mockResolvedValue(undefined);
      (service as any).refreshHeadcount = jest.fn().mockResolvedValue(undefined);

      const before = Date.now();
      await service.createTenant(
        {
          companyName: 'Acme',
          subdomain: 'acme',
          adminEmail: 'a@x.test',
          adminName: 'A',
          plan: 'GROWTH',
        } as any,
        'ops@x.test',
      );

      const data = prisma.tenant.create.mock.calls[0][0].data;
      expect(data.status).toBe('TRIAL');
      expect(data.subscription.create.plan).toBe('GROWTH');
      const trialEndsAt: Date = data.subscription.create.trialEndsAt;
      expect(trialEndsAt.getTime()).toBeGreaterThanOrEqual(before + 7 * DAY_MS);
      expect(trialEndsAt.getTime()).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS);
    });

    it('uses the operator-chosen trialDays', async () => {
      const prisma = buildFakePlatformPrisma({});
      prisma.tenant.findUnique.mockResolvedValueOnce(null);
      const { service } = buildService(prisma);
      (service as any).seedCompanyAdmin = jest.fn().mockResolvedValue({ resetEmailSent: true });
      (service as any).seedTenantDefaults = jest.fn().mockResolvedValue(undefined);
      (service as any).refreshHeadcount = jest.fn().mockResolvedValue(undefined);

      await service.createTenant(
        {
          companyName: 'Acme',
          subdomain: 'acme',
          adminEmail: 'a@x.test',
          adminName: 'A',
          trialDays: 14,
        } as any,
        'ops@x.test',
      );

      const trialEndsAt: Date =
        prisma.tenant.create.mock.calls[0][0].data.subscription.create.trialEndsAt;
      expect(Math.round((trialEndsAt.getTime() - Date.now()) / DAY_MS)).toBe(14);
    });
  });

  describe('setTrialEnd', () => {
    it('updates the end date of a TRIAL tenant and keeps its status', async () => {
      const prisma = buildFakePlatformPrisma({
        tenant: {
          status: 'TRIAL',
          subscription: { plan: 'GROWTH', trialEndsAt: new Date(future(2)) },
        },
      });
      const { service } = buildService(prisma);

      const result = await service.setTrialEnd(
        'tenant-1',
        { trialEndsAt: future(10), reason: 'Client asked for more time' } as any,
        'ops@x.test',
      );

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'tenant-1' } }),
      );
      expect(prisma.tenant.update).not.toHaveBeenCalled();
      expect(result.status).toBe('TRIAL');
      expect(prisma.platformAuditLog.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({
          action: 'tenant.trial_updated',
          actorEmail: 'ops@x.test',
          metadata: expect.objectContaining({
            reason: 'Client asked for more time',
            reopened: false,
          }),
        }),
      );
    });

    it('reopens a READ_ONLY tenant when the new date is in the future', async () => {
      const prisma = buildFakePlatformPrisma({
        tenant: {
          status: 'READ_ONLY',
          subscription: { plan: 'GROWTH', trialEndsAt: new Date(past(1)) },
        },
      });
      const { service } = buildService(prisma);

      const result = await service.setTrialEnd(
        'tenant-1',
        { trialEndsAt: future(5), reason: 'Extension approved' } as any,
        'ops@x.test',
      );

      expect(prisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
        data: { status: 'TRIAL' },
      });
      expect(result.status).toBe('TRIAL');
    });

    it.each([
      ['ACTIVE', 'already converted'],
      ['SUSPENDED', 'cannot be changed'],
    ])('refuses a %s tenant', async (status, message) => {
      const prisma = buildFakePlatformPrisma({
        tenant: { status, subscription: { plan: 'GROWTH', trialEndsAt: null } },
      });
      const { service } = buildService(prisma);

      await expect(
        service.setTrialEnd(
          'tenant-1',
          { trialEndsAt: future(5), reason: 'nope nope' } as any,
          'ops@x.test',
        ),
      ).rejects.toThrow(message);
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('refuses a date in the past', async () => {
      const prisma = buildFakePlatformPrisma({
        tenant: { status: 'TRIAL', subscription: { plan: 'GROWTH', trialEndsAt: null } },
      });
      const { service } = buildService(prisma);

      await expect(
        service.setTrialEnd(
          'tenant-1',
          { trialEndsAt: past(1), reason: 'backdating' } as any,
          'ops@x.test',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('refuses an unparseable date', async () => {
      const prisma = buildFakePlatformPrisma({
        tenant: { status: 'TRIAL', subscription: { plan: 'GROWTH', trialEndsAt: null } },
      });
      const { service } = buildService(prisma);

      await expect(
        service.setTrialEnd(
          'tenant-1',
          { trialEndsAt: 'not-a-date-at-all', reason: 'bad input' } as any,
          'ops@x.test',
        ),
      ).rejects.toThrow('valid date');
    });
  });

  describe('convertTenant', () => {
    it('keeps the plan when it is unchanged, ends the trial and starts a yearly term', async () => {
      const prisma = buildFakePlatformPrisma({
        tenant: {
          status: 'READ_ONLY',
          subscription: { plan: 'GROWTH', trialEndsAt: new Date(past(1)) },
        },
      });
      const { service } = buildService(prisma);
      const changePlan = jest.spyOn(service, 'changeTenantPlan');

      const result = await service.convertTenant(
        'tenant-1',
        { plan: 'GROWTH', reason: 'Payment received' } as any,
        'ops@x.test',
      );

      expect(changePlan).not.toHaveBeenCalled();
      expect(prisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
        data: { status: 'ACTIVE' },
      });
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ trialEndsAt: null }) }),
      );
      const renews: Date = new Date(result.renewsAt);
      expect(renews.getFullYear()).toBe(new Date().getFullYear() + 1);
    });

    it('routes a different plan through changeTenantPlan so entitlements re-snapshot', async () => {
      const prisma = buildFakePlatformPrisma({
        tenant: {
          status: 'TRIAL',
          subscription: { plan: 'STARTER', trialEndsAt: new Date(future(3)) },
        },
      });
      const { service } = buildService(prisma);
      const changePlan = jest.spyOn(service, 'changeTenantPlan').mockResolvedValue({} as any);

      await service.convertTenant(
        'tenant-1',
        { plan: 'ENTERPRISE', reason: 'Upgraded on signing' } as any,
        'ops@x.test',
      );

      expect(changePlan).toHaveBeenCalledWith(
        'tenant-1',
        { plan: 'ENTERPRISE', reason: 'Upgraded on signing' },
        'ops@x.test',
      );
      expect(prisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
        data: { status: 'ACTIVE' },
      });
    });

    it('refuses an already-converted tenant and never touches the subscription', async () => {
      const prisma = buildFakePlatformPrisma({
        tenant: { status: 'ACTIVE', subscription: { plan: 'GROWTH', trialEndsAt: null } },
      });
      const { service } = buildService(prisma);

      await expect(
        service.convertTenant(
          'tenant-1',
          { plan: 'GROWTH', reason: 'double click' } as any,
          'ops@x.test',
        ),
      ).rejects.toThrow('already converted');
      expect(prisma.tenant.update).not.toHaveBeenCalled();
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('refuses a suspended tenant', async () => {
      const prisma = buildFakePlatformPrisma({
        tenant: { status: 'SUSPENDED', subscription: { plan: 'GROWTH', trialEndsAt: null } },
      });
      const { service } = buildService(prisma);

      await expect(
        service.convertTenant(
          'tenant-1',
          { plan: 'GROWTH', reason: 'still suspended' } as any,
          'ops@x.test',
        ),
      ).rejects.toThrow('Resume the tenant');
    });
  });

  describe('expireTrials', () => {
    it('moves every expired TRIAL tenant to READ_ONLY and audits each one', async () => {
      const expired = [
        { id: 'tenant-a', subscription: { trialEndsAt: new Date(past(1)) } },
        { id: 'tenant-b', subscription: { trialEndsAt: new Date(past(3)) } },
      ];
      const prisma = buildFakePlatformPrisma({ expiredTenants: expired });
      const { service } = buildService(prisma);
      const now = new Date('2026-10-10T00:00:00Z');

      const moved = await service.expireTrials(now);

      expect(moved).toBe(2);
      expect(prisma.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'TRIAL', subscription: { is: { trialEndsAt: { lte: now } } } },
        }),
      );
      expect(prisma.tenant.update).toHaveBeenCalledTimes(2);
      expect(prisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-a' },
        data: { status: 'READ_ONLY' },
      });
      expect(prisma.platformAuditLog.create).toHaveBeenCalledTimes(2);
      expect(prisma.platformAuditLog.create.mock.calls[0][0].data.action).toBe(
        'tenant.trial_expired',
      );
    });

    it('does nothing when no trial has ended', async () => {
      const prisma = buildFakePlatformPrisma({ expiredTenants: [] });
      const { service } = buildService(prisma);

      expect(await service.expireTrials()).toBe(0);
      expect(prisma.tenant.update).not.toHaveBeenCalled();
    });
  });
});

function past(days: number) {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}
