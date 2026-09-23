import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

/** Minimal fake of the tenant-scoped Prisma surface EmployeesService touches. */
function buildFakeTenantPrisma(employee: Record<string, any>, overrides: Record<string, any> = {}) {
  const client: any = {
    employee: {
      findFirst: jest.fn().mockResolvedValue(employee),
      findUnique: jest.fn().mockResolvedValue(employee),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn((args: any) => ({ ...employee, ...args.data })),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    department: {
      findUnique: jest.fn().mockResolvedValue({ id: 'dept-1', name: 'Engineering' }),
      update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })),
      delete: jest.fn().mockResolvedValue({ id: 'dept-1' }),
    },
    emergencyContact: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn((args: any) => ({ id: 'contact-1', ...args.data })),
      update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn().mockResolvedValue({ id: 'contact-1' }),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn((arg: any) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg(client);
    }),
    ...overrides,
  };
  return { tenantId: 'tenant-1', client };
}

function fakeFirebaseAuth(overrides: Record<string, any> = {}) {
  return {
    updateUser: jest.fn().mockResolvedValue(undefined),
    revokeRefreshTokens: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function fakeFieldEncryption(overrides: Record<string, any> = {}) {
  return {
    encrypt: jest.fn((plaintext: string) => `enc:${plaintext}`),
    decrypt: jest.fn((ciphertext: string) => ciphertext.replace(/^enc:/, '')),
    ...overrides,
  };
}

function actor(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    sub: 'user-hr',
    tenantId: 'tenant-1',
    role: 'HR_MANAGER',
    email: 'hr.manager@test.com',
    employeeId: 'emp-hr',
    ...overrides,
  };
}

function fakeStorage(overrides: Record<string, any> = {}) {
  return {
    buildKey: jest.fn(
      (tenantId: string, employeeId: string, name: string) => `${tenantId}/${employeeId}/${name}`,
    ),
    upload: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://signed.example/photo'),
    ...overrides,
  };
}

function buildService(
  employee: Record<string, any>,
  firebaseOverrides: Record<string, any> = {},
  prismaOverrides: Record<string, any> = {},
  storageOverrides: Record<string, any> = {},
) {
  const tenantPrisma = buildFakeTenantPrisma(employee, prismaOverrides);
  const firebaseAuth = fakeFirebaseAuth(firebaseOverrides);
  const fieldEncryption = fakeFieldEncryption();
  const storage = fakeStorage(storageOverrides);
  const service = new EmployeesService(
    tenantPrisma as any,
    storage as any,
    fieldEncryption as any,
    firebaseAuth as any,
  );
  return { service, tenantPrisma, firebaseAuth, fieldEncryption, storage };
}

describe('EmployeesService.transitionLifecycle', () => {
  it('moves PROBATION -> CONFIRMED when confirmationDate is given', async () => {
    const { service, tenantPrisma } = buildService({
      id: 'emp-1',
      employeeCode: 'LUM-1',
      lifecycleState: 'PROBATION',
      userId: null,
    });

    const result = await service.transitionLifecycle(
      'emp-1',
      { targetState: 'CONFIRMED', effectiveDate: '2026-03-01', reason: 'Probation cleared' },
      actor(),
    );

    expect(result.lifecycleState).toBe('CONFIRMED');
    expect(tenantPrisma.client.employee.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { lifecycleState: 'CONFIRMED', confirmationDate: new Date('2026-03-01') },
    });
    expect(tenantPrisma.client.auditLog.create).toHaveBeenCalled();
  });

  it('rejects PROBATION -> CONFIRMED without the required confirmationDate', async () => {
    const { service } = buildService({
      id: 'emp-1',
      employeeCode: 'LUM-1',
      lifecycleState: 'PROBATION',
      userId: null,
    });

    await expect(
      service.transitionLifecycle('emp-1', { targetState: 'CONFIRMED', reason: 'oops' }, actor()),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an illegal transition (SEPARATED is terminal)', async () => {
    const { service } = buildService({
      id: 'emp-1',
      employeeCode: 'LUM-1',
      lifecycleState: 'SEPARATED',
      userId: null,
    });

    await expect(
      service.transitionLifecycle(
        'emp-1',
        { targetState: 'CONFIRMED', reason: 'reinstate' },
        actor(),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows NOTICE_PERIOD -> CONFIRMED (withdrawal) without a date', async () => {
    const { service } = buildService({
      id: 'emp-1',
      employeeCode: 'LUM-1',
      lifecycleState: 'NOTICE_PERIOD',
      userId: null,
    });

    const result = await service.transitionLifecycle(
      'emp-1',
      { targetState: 'CONFIRMED', reason: 'Employee withdrew resignation' },
      actor(),
    );
    expect(result.lifecycleState).toBe('CONFIRMED');
  });

  it('cascades SEPARATED into disabling the linked login', async () => {
    const { service, tenantPrisma, firebaseAuth } = buildService(
      { id: 'emp-1', employeeCode: 'LUM-1', lifecycleState: 'NOTICE_PERIOD', userId: 'user-1' },
      {},
    );
    tenantPrisma.client.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'emp@test.com',
      firebaseUid: 'fb-1',
      isActive: true,
    });

    await service.transitionLifecycle(
      'emp-1',
      { targetState: 'SEPARATED', effectiveDate: '2026-03-15', reason: 'Resignation' },
      actor(),
    );

    expect(firebaseAuth.updateUser).toHaveBeenCalledWith('fb-1', { disabled: true });
    expect(firebaseAuth.revokeRefreshTokens).toHaveBeenCalledWith('fb-1');
    expect(tenantPrisma.client.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { isActive: false },
    });
  });

  it('does not separate the employee if the Firebase disable call fails', async () => {
    const { service, tenantPrisma } = buildService(
      { id: 'emp-1', employeeCode: 'LUM-1', lifecycleState: 'NOTICE_PERIOD', userId: 'user-1' },
      { updateUser: jest.fn().mockRejectedValue(new Error('provider down')) },
    );
    tenantPrisma.client.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'emp@test.com',
      firebaseUid: 'fb-1',
      isActive: true,
    });

    await expect(
      service.transitionLifecycle(
        'emp-1',
        { targetState: 'SEPARATED', effectiveDate: '2026-03-15', reason: 'Resignation' },
        actor(),
      ),
    ).rejects.toThrow(BadRequestException);

    expect(tenantPrisma.client.employee.update).not.toHaveBeenCalled();
  });
});

describe('EmployeesService.updateSensitiveFields / revealField', () => {
  it('encrypts PAN and bank account, storing only ciphertext + a masked form', async () => {
    const { service, tenantPrisma, fieldEncryption } = buildService({
      id: 'emp-1',
      employeeCode: 'LUM-1',
      lifecycleState: 'CONFIRMED',
      userId: null,
    });

    await service.updateSensitiveFields(
      'emp-1',
      { pan: 'ABCDE1234F', bankAccountNumber: '123456789012' },
      actor(),
    );

    expect(fieldEncryption.encrypt).toHaveBeenCalledWith('ABCDE1234F');
    expect(fieldEncryption.encrypt).toHaveBeenCalledWith('123456789012');
    const updateCall = tenantPrisma.client.employee.update.mock.calls[0][0];
    expect(updateCall.data.panCiphertext).toBe('enc:ABCDE1234F');
    expect(updateCall.data.panMasked).toBe('ABCDE****F');
    expect(updateCall.data.bankAccountMasked).toBe('••••9012');
    expect(tenantPrisma.client.auditLog.create).toHaveBeenCalled();
    // The audit metadata never carries the plaintext value.
    const auditData = tenantPrisma.client.auditLog.create.mock.calls[0][0].data;
    expect(JSON.stringify(auditData)).not.toContain('ABCDE1234F');
  });

  it('reveals a field by decrypting it and logs the reveal without the value', async () => {
    const { service, tenantPrisma } = buildService({
      id: 'emp-1',
      employeeCode: 'LUM-1',
      panCiphertext: 'enc:ABCDE1234F',
      bankAccountCiphertext: null,
    });

    const result = await service.revealField(
      'emp-1',
      { field: 'pan', reason: 'ITD reconciliation' },
      actor(),
    );

    expect(result).toEqual({ field: 'pan', value: 'ABCDE1234F' });
    const auditData = tenantPrisma.client.auditLog.create.mock.calls[0][0].data;
    expect(auditData.action).toBe('employee.field_revealed');
    expect(JSON.stringify(auditData)).not.toContain('ABCDE1234F');
  });

  it('rejects revealing a field that has never been set', async () => {
    const { service } = buildService({
      id: 'emp-1',
      employeeCode: 'LUM-1',
      panCiphertext: null,
      bankAccountCiphertext: null,
    });

    await expect(
      service.revealField('emp-1', { field: 'pan', reason: 'audit' }, actor()),
    ).rejects.toThrow(BadRequestException);
  });

  it('never returns ciphertext from get()/list()', async () => {
    const { service } = buildService({
      id: 'emp-1',
      employeeCode: 'LUM-1',
      panCiphertext: 'enc:ABCDE1234F',
      bankAccountCiphertext: 'enc:123456789012',
      panMasked: 'ABCDE****F',
    });

    const result = await service.get('emp-1', actor());
    expect(result).not.toHaveProperty('panCiphertext');
    expect(result).not.toHaveProperty('bankAccountCiphertext');
    expect((result as any).panMasked).toBe('ABCDE****F');
  });
});

describe('EmployeesService emergency contacts', () => {
  it('unsets the previous primary contact when a new one is created as primary', async () => {
    const { service, tenantPrisma } = buildService({ id: 'emp-1', employeeCode: 'LUM-1' });

    await service.createEmergencyContact(
      'emp-1',
      { name: 'Neha Sharma', relationship: 'Spouse', phone: '9800000000', isPrimary: true },
      actor(),
    );

    expect(tenantPrisma.client.emergencyContact.updateMany).toHaveBeenCalledWith({
      where: { employeeId: 'emp-1' },
      data: { isPrimary: false },
    });
    expect(tenantPrisma.client.emergencyContact.create).toHaveBeenCalled();
  });

  it('404s deleting a contact that does not belong to the employee', async () => {
    const { service } = buildService({ id: 'emp-1', employeeCode: 'LUM-1' });
    await expect(
      service.deleteEmergencyContact('emp-1', 'not-a-real-contact', actor()),
    ).rejects.toThrow('Emergency contact not found');
  });
});

describe('EmployeesService.deleteDepartment (RULE-6 reassign guard)', () => {
  it('blocks deleting a non-empty department with no reassignment target', async () => {
    const { service, tenantPrisma } = buildService({ id: 'emp-1', employeeCode: 'LUM-1' });
    tenantPrisma.client.employee.count.mockResolvedValue(3);

    await expect(service.deleteDepartment('dept-1', {})).rejects.toThrow(BadRequestException);
    expect(tenantPrisma.client.department.delete).not.toHaveBeenCalled();
  });

  it('reassigns employees then deletes when a target department is given', async () => {
    const { service, tenantPrisma } = buildService({ id: 'emp-1', employeeCode: 'LUM-1' });
    tenantPrisma.client.employee.count.mockResolvedValue(3);
    tenantPrisma.client.department.findUnique
      .mockResolvedValueOnce({ id: 'dept-1', name: 'Engineering' })
      .mockResolvedValueOnce({ id: 'dept-2', name: 'Product' });

    const result = await service.deleteDepartment('dept-1', { reassignToDepartmentId: 'dept-2' });

    expect(result).toEqual({ reassigned: 3, deleted: true });
    expect(tenantPrisma.client.employee.updateMany).toHaveBeenCalledWith({
      where: { departmentId: 'dept-1' },
      data: { departmentId: 'dept-2' },
    });
    expect(tenantPrisma.client.department.delete).toHaveBeenCalledWith({ where: { id: 'dept-1' } });
  });

  it('deletes an empty department with no reassignment needed', async () => {
    const { service, tenantPrisma } = buildService({ id: 'emp-1', employeeCode: 'LUM-1' });
    tenantPrisma.client.employee.count.mockResolvedValue(0);

    const result = await service.deleteDepartment('dept-1', {});
    expect(result).toEqual({ reassigned: 0, deleted: true });
    expect(tenantPrisma.client.department.delete).toHaveBeenCalled();
  });
});

describe('EmployeesService line-manager recursive subtree scoping', () => {
  it('list() includes indirect reports, not just direct reports', async () => {
    const { service, tenantPrisma } = buildService({ id: 'mgr-1', employeeCode: 'LUM-1' });
    // mgr-1 -> emp-a -> emp-b (emp-b is an INDIRECT report of mgr-1)
    tenantPrisma.client.employee.findMany
      .mockResolvedValueOnce([
        { id: 'mgr-1', reportingManagerId: null },
        { id: 'emp-a', reportingManagerId: 'mgr-1' },
        { id: 'emp-b', reportingManagerId: 'emp-a' },
        { id: 'emp-c', reportingManagerId: null }, // unrelated
      ])
      .mockResolvedValueOnce([]); // the actual list() query, contents unimportant here

    await service.list(actor({ role: 'LINE_MANAGER', employeeId: 'mgr-1' }));

    const listWhere = tenantPrisma.client.employee.findMany.mock.calls[1][0].where;
    expect(listWhere.id.in).toEqual(expect.arrayContaining(['mgr-1', 'emp-a', 'emp-b']));
    expect(listWhere.id.in).not.toContain('emp-c');
  });

  it('never infinite-loops on a cyclic reportingManagerId chain', async () => {
    const { service, tenantPrisma } = buildService({ id: 'mgr-1', employeeCode: 'LUM-1' });
    // Bad data forming a genuine cycle reachable from mgr-1:
    // mgr-1 -> a -> b -> mgr-1 (b incorrectly lists mgr-1 as its report).
    tenantPrisma.client.employee.findMany
      .mockResolvedValueOnce([
        { id: 'mgr-1', reportingManagerId: 'b' },
        { id: 'a', reportingManagerId: 'mgr-1' },
        { id: 'b', reportingManagerId: 'a' },
      ])
      .mockResolvedValueOnce([]);

    await expect(
      service.list(actor({ role: 'LINE_MANAGER', employeeId: 'mgr-1' })),
    ).resolves.toBeDefined();
  });
});

describe('EmployeesService.update (RULE-1 self-edit whitelist)', () => {
  it('lets an Employee edit their own contact/personal fields', async () => {
    const { service, tenantPrisma } = buildService({ id: 'emp-1', employeeCode: 'LUM-1' });

    await service.update(
      'emp-1',
      { phone: '9999999999', personalEmail: 'me@test.com' },
      actor({ role: 'EMPLOYEE', employeeId: 'emp-1' }),
    );

    expect(tenantPrisma.client.employee.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: {
        personalEmail: 'me@test.com',
        phone: '9999999999',
        gender: undefined,
        maritalStatus: undefined,
        bloodGroup: undefined,
        nationality: undefined,
      },
    });
  });

  it("silently drops fields outside an Employee's whitelist instead of applying them", async () => {
    const { service, tenantPrisma } = buildService({ id: 'emp-1', employeeCode: 'LUM-1' });

    await service.update(
      'emp-1',
      { phone: '9999999999', designation: 'Should not apply', ctcAnnual: 999999 } as any,
      actor({ role: 'EMPLOYEE', employeeId: 'emp-1' }),
    );

    const data = tenantPrisma.client.employee.update.mock.calls[0][0].data;
    expect(data.phone).toBe('9999999999');
    expect(data).not.toHaveProperty('designation');
    expect(data).not.toHaveProperty('ctcAnnual');
  });

  it('rejects an Employee editing someone else’s record', async () => {
    const { service } = buildService({ id: 'emp-1', employeeCode: 'LUM-1' });
    await expect(
      service.update(
        'someone-else',
        { phone: '1' },
        actor({ role: 'EMPLOYEE', employeeId: 'emp-1' }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a Line Manager editing any employee record', async () => {
    const { service } = buildService({ id: 'emp-1', employeeCode: 'LUM-1' });
    await expect(
      service.update('emp-1', { phone: '1' }, actor({ role: 'LINE_MANAGER' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lets HR Manager edit the full field set on any employee', async () => {
    const { service, tenantPrisma } = buildService({ id: 'emp-1', employeeCode: 'LUM-1' });

    await service.update('emp-1', { designation: 'Staff Engineer', ctcAnnual: 1500000 }, actor());

    const data = tenantPrisma.client.employee.update.mock.calls[0][0].data;
    expect(data.designation).toBe('Staff Engineer');
    expect(data.ctcAnnual).toBe(1500000);
  });
});

describe('EmployeesService emergency-contact write authorization', () => {
  it("blocks a Line Manager from writing a report's emergency contacts (view != edit)", async () => {
    const { service } = buildService({ id: 'report-1', employeeCode: 'LUM-1' });
    const lineManager = actor({ role: 'LINE_MANAGER', employeeId: 'mgr-1' });

    await expect(
      service.createEmergencyContact(
        'report-1',
        { name: 'X', relationship: 'Friend', phone: '1' },
        lineManager,
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.updateEmergencyContact(
        'report-1',
        'contact-1',
        { name: 'X', relationship: 'Friend', phone: '1' },
        lineManager,
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.deleteEmergencyContact('report-1', 'contact-1', lineManager),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lets an Employee write their own emergency contacts', async () => {
    const { service, tenantPrisma } = buildService({ id: 'emp-1', employeeCode: 'LUM-1' });

    await service.createEmergencyContact(
      'emp-1',
      { name: 'Neha', relationship: 'Spouse', phone: '1' },
      actor({ role: 'EMPLOYEE', employeeId: 'emp-1' }),
    );

    expect(tenantPrisma.client.emergencyContact.create).toHaveBeenCalled();
  });

  it("blocks an Employee from writing someone else's emergency contacts", async () => {
    const { service } = buildService({ id: 'emp-1', employeeCode: 'LUM-1' });
    await expect(
      service.createEmergencyContact(
        'someone-else',
        { name: 'X', relationship: 'Friend', phone: '1' },
        actor({ role: 'EMPLOYEE', employeeId: 'emp-1' }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('EmployeesService.uploadPhoto', () => {
  const file = {
    originalname: 'me.jpg',
    mimetype: 'image/jpeg',
    size: 1024,
    buffer: Buffer.from('x'),
  } as any;

  it('uploads, updates photoKey, deletes the old object, and returns a resolved URL', async () => {
    const { service, tenantPrisma, storage } = buildService({
      id: 'emp-1',
      employeeCode: 'LUM-1',
      photoKey: 'old/key.jpg',
    });

    const result = await service.uploadPhoto('emp-1', file, actor({ role: 'HR_MANAGER' }));

    expect(storage.upload).toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledWith('old/key.jpg');
    expect(tenantPrisma.client.employee.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { photoKey: expect.any(String) },
    });
    expect(result).toEqual({ photoUrl: 'https://signed.example/photo' });
  });

  it('lets an Employee upload their own photo but not someone else’s', async () => {
    const { service } = buildService({ id: 'emp-1', employeeCode: 'LUM-1' });

    await expect(
      service.uploadPhoto('emp-1', file, actor({ role: 'EMPLOYEE', employeeId: 'emp-1' })),
    ).resolves.toBeDefined();
    await expect(
      service.uploadPhoto('someone-else', file, actor({ role: 'EMPLOYEE', employeeId: 'emp-1' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects an unsupported file type', async () => {
    const { service } = buildService({ id: 'emp-1', employeeCode: 'LUM-1' });
    await expect(
      service.uploadPhoto(
        'emp-1',
        { ...file, mimetype: 'application/pdf' },
        actor({ role: 'HR_MANAGER' }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a file over the 5 MB limit', async () => {
    const { service } = buildService({ id: 'emp-1', employeeCode: 'LUM-1' });
    await expect(
      service.uploadPhoto(
        'emp-1',
        { ...file, size: 6 * 1024 * 1024 },
        actor({ role: 'HR_MANAGER' }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('404s for an unknown employee', async () => {
    const { service, tenantPrisma } = buildService({ id: 'emp-1', employeeCode: 'LUM-1' });
    tenantPrisma.client.employee.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.uploadPhoto('missing', file, actor({ role: 'HR_MANAGER' })),
    ).rejects.toThrow('Employee not found');
  });
});
