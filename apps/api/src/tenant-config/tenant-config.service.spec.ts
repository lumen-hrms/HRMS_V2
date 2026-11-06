import { BadRequestException } from '@nestjs/common';
import { TenantConfigService } from './tenant-config.service';
import { companyProfileErrors } from './company-profile';

const validProfile = {
  legalName: 'Acme Health Pvt Ltd',
  addressLine1: '12 MG Road',
  city: 'Pune',
  state: 'MAHARASHTRA',
  pincode: '411001',
  contactEmail: 'HR@Acme.example',
  contactPhone: '98765 43210',
  gstin: '27aapfu0939f1zv',
};

function buildService() {
  const companyProfile = {
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn((args: any) => ({ id: 'cp-1', ...args.create })),
  };
  const tenantSettings = {
    findUnique: jest.fn().mockResolvedValue({ goLiveDate: new Date('2026-10-01') }),
  };
  const tenantPrisma = { tenantId: 'tenant-1', client: { companyProfile, tenantSettings } };
  const service = new TenantConfigService(tenantPrisma as any);
  return { service, tenantPrisma };
}

describe('TenantConfigService company profile', () => {
  it('returns the profile with the go-live date as YYYY-MM-DD', async () => {
    const { service } = buildService();

    await expect(service.getCompanyProfile()).resolves.toEqual({
      profile: null,
      goLiveDate: '2026-10-01',
    });
  });

  it('upserts a normalized profile scoped to the current tenant', async () => {
    const { service, tenantPrisma } = buildService();

    await service.updateCompanyProfile(validProfile as any);

    const args = tenantPrisma.client.companyProfile.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ tenantId: 'tenant-1' });
    expect(args.create).toMatchObject({
      tenantId: 'tenant-1',
      contactEmail: 'hr@acme.example',
      contactPhone: '9876543210',
      gstin: '27AAPFU0939F1ZV',
      addressLine2: null,
      cin: null,
    });
  });

  it('rejects an invalid profile without writing', async () => {
    const { service, tenantPrisma } = buildService();

    await expect(
      service.updateCompanyProfile({ ...validProfile, pincode: '0110' } as any),
    ).rejects.toThrow(BadRequestException);
    expect(tenantPrisma.client.companyProfile.upsert).not.toHaveBeenCalled();
  });
});

describe('companyProfileErrors', () => {
  it('accepts a complete profile', () => {
    expect(companyProfileErrors(validProfile)).toEqual({});
  });

  it('names every missing required field', () => {
    expect(Object.keys(companyProfileErrors({}))).toEqual([
      'legalName',
      'addressLine1',
      'city',
      'state',
      'pincode',
      'contactEmail',
      'contactPhone',
    ]);
  });

  it('rejects bad formats for state, PIN, email, phone, GSTIN and CIN', () => {
    const errors = companyProfileErrors({
      ...validProfile,
      state: 'GOTHAM',
      pincode: '12345',
      contactEmail: 'nope',
      contactPhone: '12345',
      gstin: 'ABC',
      cin: 'XYZ',
    });
    expect(Object.keys(errors).sort()).toEqual(
      ['cin', 'contactEmail', 'contactPhone', 'gstin', 'pincode', 'state'].sort(),
    );
  });
});
