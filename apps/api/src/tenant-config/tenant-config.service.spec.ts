import { TenantConfigService } from './tenant-config.service';

function buildService(overrides: Record<string, any> = {}) {
  const tenantSettings = {
    findUniqueOrThrow: jest
      .fn()
      .mockResolvedValue({ setupWizardStatus: 'PENDING', setupWizardStep: 0 }),
    update: jest.fn((args: any) => ({
      setupWizardStatus: args.data.setupWizardStatus,
      setupWizardStep: args.data.setupWizardStep,
    })),
    ...overrides,
  };
  const tenantPrisma = { tenantId: 'tenant-1', client: { tenantSettings } };
  const service = new TenantConfigService(tenantPrisma as any);
  return { service, tenantPrisma };
}

describe('TenantConfigService', () => {
  it('getWizardState reads status/step scoped to the current tenant', async () => {
    const { service, tenantPrisma } = buildService();

    const result = await service.getWizardState();

    expect(tenantPrisma.client.tenantSettings.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
      select: { setupWizardStatus: true, setupWizardStep: true },
    });
    expect(result).toEqual({ status: 'PENDING', step: 0 });
  });

  it('updateWizardState writes status/step and returns the new state', async () => {
    const { service, tenantPrisma } = buildService();

    const result = await service.updateWizardState({ status: 'IN_PROGRESS', step: 2 });

    expect(tenantPrisma.client.tenantSettings.update).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
      data: { setupWizardStatus: 'IN_PROGRESS', setupWizardStep: 2 },
      select: { setupWizardStatus: true, setupWizardStep: true },
    });
    expect(result).toEqual({ status: 'IN_PROGRESS', step: 2 });
  });
});
