import { LoginAuditRetentionProcessor } from './login-audit-retention.processor';
import * as withTenantContextModule from '../prisma/with-tenant-context';

jest.mock('../prisma/with-tenant-context');

describe('LoginAuditRetentionProcessor', () => {
  function buildProcessor(tenantIds: string[]) {
    const deleteMany = jest.fn().mockResolvedValue({ count: 3 });
    const fakeTenantClient = { loginAuditEntry: { deleteMany } };
    (withTenantContextModule.withTenantContext as jest.Mock).mockReturnValue(fakeTenantClient);

    const fakeQueue = { upsertJobScheduler: jest.fn() };
    const fakePlatformPrisma = {
      tenant: { findMany: jest.fn().mockResolvedValue(tenantIds.map((id) => ({ id }))) },
    };
    const fakeTenantPrismaRaw = {};

    const processor = new LoginAuditRetentionProcessor(
      fakeQueue as any,
      fakePlatformPrisma as any,
      fakeTenantPrismaRaw as any,
    );
    return { processor, deleteMany, fakeQueue, fakePlatformPrisma };
  }

  it('registers a daily repeatable job on module init', async () => {
    const { processor, fakeQueue } = buildProcessor([]);
    await processor.onModuleInit();
    expect(fakeQueue.upsertJobScheduler).toHaveBeenCalledWith(
      'login-audit-retention-daily',
      { pattern: '0 2 * * *' },
      { name: 'purge' },
    );
  });

  it('ignores jobs that are not the purge job', async () => {
    const { processor, deleteMany } = buildProcessor(['tenant-1']);
    await processor.process({ name: 'not-purge' } as any);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('purges login audit entries older than 2 years for every tenant', async () => {
    const { processor, deleteMany, fakePlatformPrisma } = buildProcessor(['tenant-1', 'tenant-2']);
    const now = new Date('2026-09-18T00:00:00.000Z');

    await processor.runPurge(now);

    expect(fakePlatformPrisma.tenant.findMany).toHaveBeenCalledWith({ select: { id: true } });
    expect(deleteMany).toHaveBeenCalledTimes(2);
    const cutoff = deleteMany.mock.calls[0][0].where.at.lt as Date;
    expect(cutoff.toISOString()).toBe('2024-09-18T00:00:00.000Z');
  });

  it('runs the scheduled job through process()', async () => {
    const { processor, deleteMany } = buildProcessor(['tenant-1']);
    await processor.process({ name: 'purge' } as any);
    expect(deleteMany).toHaveBeenCalledTimes(1);
  });
});
