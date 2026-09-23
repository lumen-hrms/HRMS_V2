import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { DocumentsService } from './documents.service';

const PDF = Buffer.from('%PDF-1.7\n...');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function file(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  const buffer = overrides.buffer ?? PDF;
  return {
    originalname: 'proof.pdf',
    mimetype: 'application/pdf',
    size: buffer.length,
    buffer,
    ...overrides,
  } as Express.Multer.File;
}

function actor(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    sub: 'user-1',
    tenantId: 'tenant-1',
    role: 'COMPANY_ADMIN',
    email: 'jane.doe@acme.test',
    employeeId: 'emp-admin',
    ...overrides,
  };
}

function docRow(overrides: Record<string, any> = {}) {
  return {
    id: 'doc-1',
    tenantId: 'tenant-1',
    employeeId: 'emp-1',
    ownerType: 'EMPLOYEE_PROFILE',
    ownerId: null,
    label: 'proof.pdf',
    category: 'OTHER',
    storageKey: 'tenants/tenant-1/employees/emp-1/profile/uuid-proof.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 10,
    scanStatus: 'CLEAN',
    scannedAt: new Date(),
    scanSignature: null,
    uploadedById: 'user-1',
    uploadedByName: 'Jane Doe',
    uploadedAt: new Date(),
    deletedAt: null,
    deletedById: null,
    ...overrides,
  };
}

function build(clientOverrides: Record<string, any> = {}) {
  const client = {
    employee: {
      findUnique: jest.fn().mockResolvedValue({ id: 'emp-1' }),
      findMany: jest.fn().mockResolvedValue([
        { id: 'emp-mgr', reportingManagerId: null },
        { id: 'emp-1', reportingManagerId: 'emp-mgr' },
        { id: 'emp-2', reportingManagerId: 'emp-1' }, // grand-report of emp-mgr
        { id: 'emp-other', reportingManagerId: null },
      ]),
    },
    document: {
      create: jest.fn((args: any) =>
        docRow({ ...args.data, id: 'doc-new', scanStatus: 'PENDING_SCAN' }),
      ),
      findFirst: jest.fn().mockResolvedValue(docRow()),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn((args: any) => docRow({ ...args.data })),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    ...clientOverrides,
  };
  const storage = {
    buildKey: jest.fn(
      (t: string, e: string, name: string, seg: string) =>
        `tenants/${t}/employees/${e}/${seg}/x-${name}`,
    ),
    upload: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://signed.example/url'),
  };
  const queue = { add: jest.fn().mockResolvedValue({}) };
  const service = new DocumentsService(
    { tenantId: 'tenant-1', client } as any,
    storage as any,
    queue as any,
  );
  return { service, client, storage, queue };
}

describe('DocumentsService.upload validation (RULE-1)', () => {
  const cases: [string, Express.Multer.File | undefined][] = [
    ['a missing file', undefined],
    ['an empty file', file({ buffer: Buffer.alloc(0), size: 0 })],
    ['a disallowed MIME type', file({ mimetype: 'text/html', buffer: Buffer.from('<html>') })],
    ['a file over the 10MB cap', file({ size: 10 * 1024 * 1024 + 1 })],
    ['PNG bytes labelled as a PDF', file({ buffer: PNG })],
    ['PDF bytes labelled as a PNG', file({ mimetype: 'image/png', originalname: 'x.png' })],
  ];

  it.each(cases)('rejects %s without touching storage', async (_name, f) => {
    const { service, storage, client } = build();
    await expect(
      service.upload({ employeeId: 'emp-1', ownerType: 'EMPLOYEE_PROFILE', file: f }, actor()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(client.document.create).not.toHaveBeenCalled();
  });

  it('accepts a real PNG', async () => {
    const { service, storage } = build();
    await service.upload(
      {
        employeeId: 'emp-1',
        ownerType: 'EMPLOYEE_PROFILE',
        file: file({ mimetype: 'image/png', buffer: PNG, originalname: 'id.png' }),
      },
      actor(),
    );
    expect(storage.upload).toHaveBeenCalled();
  });

  it('requires an ownerId for attachment owner types', async () => {
    const { service, storage } = build();
    await expect(
      service.upload({ employeeId: 'emp-1', ownerType: 'LEAVE_REQUEST', file: file() }, actor()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
  });
});

describe('DocumentsService.upload', () => {
  it('stores under the owner segment, records PENDING_SCAN, enqueues a scan and audits', async () => {
    const { service, client, storage, queue } = build();
    const dto = await service.upload(
      { employeeId: 'emp-1', ownerType: 'LEAVE_REQUEST', ownerId: 'lr-1', file: file() },
      actor(),
    );

    expect(storage.buildKey).toHaveBeenCalledWith('tenant-1', 'emp-1', 'proof.pdf', 'leave/lr-1');
    expect(client.document.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerType: 'LEAVE_REQUEST',
        ownerId: 'lr-1',
        uploadedById: 'user-1',
        uploadedByName: 'Jane Doe',
      }),
    });
    expect(queue.add).toHaveBeenCalledWith(
      'scan',
      { tenantId: 'tenant-1', documentId: 'doc-new' },
      expect.objectContaining({ jobId: 'scan-doc-new', attempts: 5 }),
    );
    expect(client.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'documents.uploaded', targetId: 'doc-new' }),
    });
    expect(dto.scanStatus).toBe('PENDING_SCAN');
    expect(dto).not.toHaveProperty('storageKey');
  });

  it('soft-deletes the previous live attachment of the same owner (RULE-5)', async () => {
    const { service, client } = build();
    await service.upload(
      { employeeId: 'emp-1', ownerType: 'REGULARIZATION', ownerId: 'reg-1', file: file() },
      actor(),
    );
    expect(client.document.updateMany).toHaveBeenCalledWith({
      where: {
        ownerType: 'REGULARIZATION',
        ownerId: 'reg-1',
        deletedAt: null,
        id: { not: 'doc-new' },
      },
      data: { deletedAt: expect.any(Date), deletedById: 'user-1' },
    });
  });

  it('never replaces profile documents — an employee may have many', async () => {
    const { service, client } = build();
    await service.upload(
      { employeeId: 'emp-1', ownerType: 'EMPLOYEE_PROFILE', file: file() },
      actor(),
    );
    expect(client.document.updateMany).not.toHaveBeenCalled();
  });

  it('deletes the stored object if the row cannot be created (RULE-7)', async () => {
    const { service, storage } = build({
      document: { create: jest.fn().mockRejectedValue(new Error('db down')) },
    });
    await expect(
      service.upload({ employeeId: 'emp-1', ownerType: 'EMPLOYEE_PROFILE', file: file() }, actor()),
    ).rejects.toThrow('db down');
    const key = storage.upload.mock.calls[0][0];
    expect(storage.delete).toHaveBeenCalledWith(key);
  });

  it('still succeeds if Redis is down — the row stays PENDING_SCAN for the sweep', async () => {
    const { service, queue } = build();
    queue.add.mockRejectedValue(new Error('ECONNREFUSED'));
    const dto = await service.upload(
      { employeeId: 'emp-1', ownerType: 'EMPLOYEE_PROFILE', file: file() },
      actor(),
    );
    expect(dto.scanStatus).toBe('PENDING_SCAN');
  });
});

describe('DocumentsService.uploadProfileDocument — upload matrix (module 09 §8)', () => {
  it.each(['COMPANY_ADMIN', 'HR_MANAGER'])('%s may upload onto any employee', async (role) => {
    const { service, storage } = build();
    await service.uploadProfileDocument('emp-1', file(), 'ID', 'ID_PROOF', actor({ role }));
    expect(storage.upload).toHaveBeenCalled();
  });

  it('an Employee may upload onto themselves', async () => {
    const { service, storage } = build();
    await service.uploadProfileDocument(
      'emp-1',
      file(),
      undefined,
      undefined,
      actor({ role: 'EMPLOYEE', employeeId: 'emp-1' }),
    );
    expect(storage.upload).toHaveBeenCalled();
  });

  it.each([
    ['an Employee onto someone else', { role: 'EMPLOYEE', employeeId: 'emp-2' }],
    ['a Line Manager onto a report', { role: 'LINE_MANAGER', employeeId: 'emp-mgr' }],
    ['an Auditor', { role: 'AUDITOR', employeeId: null }],
  ])('forbids %s', async (_name, who) => {
    const { service, storage } = build();
    await expect(
      service.uploadProfileDocument('emp-1', file(), undefined, undefined, actor(who)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('404s for an employee id not in this tenant', async () => {
    const { service, storage } = build({
      employee: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn() },
    });
    await expect(
      service.uploadProfileDocument('emp-x', file(), undefined, undefined, actor()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.upload).not.toHaveBeenCalled();
  });
});

describe('DocumentsService.getDownloadUrl (RULE-2)', () => {
  it('issues a 5-minute attachment-disposition URL for a CLEAN document and audits it first', async () => {
    const { service, storage, client } = build();
    const result = await service.getDownloadUrl('doc-1', actor());
    expect(result).toEqual({ url: 'https://signed.example/url', expiresInSeconds: 300 });
    expect(storage.getPresignedDownloadUrl).toHaveBeenCalledWith(
      docRow().storageKey,
      300,
      'proof.pdf',
    );
    expect(client.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'documents.downloaded', targetId: 'doc-1' }),
    });
  });

  it('refuses to issue a URL if the audit write fails', async () => {
    const { service, storage } = build({
      auditLog: { create: jest.fn().mockRejectedValue(new Error('audit down')) },
    });
    await expect(service.getDownloadUrl('doc-1', actor())).rejects.toThrow('audit down');
    expect(storage.getPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['PENDING_SCAN', ConflictException],
    ['SCAN_FAILED', ConflictException],
    ['INFECTED', GoneException],
  ])('refuses a %s document', async (scanStatus, error) => {
    const { service, storage, client } = build();
    client.document.findFirst.mockResolvedValue(docRow({ scanStatus }));
    await expect(service.getDownloadUrl('doc-1', actor())).rejects.toBeInstanceOf(error);
    expect(storage.getPresignedDownloadUrl).not.toHaveBeenCalled();
    expect(client.auditLog.create).not.toHaveBeenCalled();
  });

  it('404s for a deleted (or nonexistent) document', async () => {
    const { service, client } = build();
    client.document.findFirst.mockResolvedValue(null);
    await expect(service.getDownloadUrl('doc-1', actor())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(client.document.findFirst).toHaveBeenCalledWith({
      where: { id: 'doc-1', deletedAt: null },
    });
  });
});

describe('DocumentsService visibility (RULE-4 — mirrors Employee scopeFor)', () => {
  const visible: [string, Partial<AuthenticatedUser>][] = [
    ['the subject employee', { role: 'EMPLOYEE', employeeId: 'emp-1' }],
    ['their direct manager', { role: 'LINE_MANAGER', employeeId: 'emp-mgr' }],
    ['HR', { role: 'HR_MANAGER', employeeId: null }],
    ['an Auditor', { role: 'AUDITOR', employeeId: null }],
  ];
  it.each(visible)('lets %s download', async (_name, who) => {
    const { service } = build();
    await expect(service.getDownloadUrl('doc-1', actor(who))).resolves.toHaveProperty('url');
  });

  it("lets a Line Manager download a grand-report's document (recursive subtree)", async () => {
    const { service, client } = build();
    client.document.findFirst.mockResolvedValue(docRow({ employeeId: 'emp-2' }));
    await expect(
      service.getDownloadUrl('doc-1', actor({ role: 'LINE_MANAGER', employeeId: 'emp-mgr' })),
    ).resolves.toHaveProperty('url');
  });

  const hidden: [string, Partial<AuthenticatedUser>][] = [
    ['another Employee', { role: 'EMPLOYEE', employeeId: 'emp-other' }],
    ['an unrelated Line Manager', { role: 'LINE_MANAGER', employeeId: 'emp-other' }],
    ['a Line Manager with no employee link', { role: 'LINE_MANAGER', employeeId: null }],
  ];
  it.each(hidden)('404s for %s', async (_name, who) => {
    const { service, storage } = build();
    await expect(service.getDownloadUrl('doc-1', actor(who))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(storage.getPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("listProfileDocuments 404s for an employee id RLS can't see (e.g. another tenant's)", async () => {
    const { service, client } = build({
      employee: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn() },
    });
    await expect(service.listProfileDocuments('emp-b', actor())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(client.document.findMany).not.toHaveBeenCalled();
  });

  it('listProfileDocuments 404s out of scope and excludes deleted/attachment rows in scope', async () => {
    const { service, client } = build();
    await expect(
      service.listProfileDocuments('emp-1', actor({ role: 'EMPLOYEE', employeeId: 'emp-2' })),
    ).rejects.toBeInstanceOf(NotFoundException);

    client.document.findMany.mockResolvedValue([docRow()]);
    const docs = await service.listProfileDocuments('emp-1', actor());
    expect(client.document.findMany).toHaveBeenCalledWith({
      where: { employeeId: 'emp-1', ownerType: 'EMPLOYEE_PROFILE', deletedAt: null },
      orderBy: { uploadedAt: 'desc' },
    });
    expect(docs[0]).not.toHaveProperty('storageKey');
  });
});

describe('DocumentsService.softDelete / setCategory', () => {
  it('soft-deletes (object kept) and audits', async () => {
    const { service, client, storage } = build();
    await expect(service.softDelete('doc-1', actor())).resolves.toEqual({ deleted: true });
    expect(client.document.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { deletedAt: expect.any(Date), deletedById: 'user-1' },
    });
    expect(storage.delete).not.toHaveBeenCalled();
    expect(client.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'documents.deleted' }),
    });
  });

  it('rejects recategorizing a non-profile attachment', async () => {
    const { service, client } = build();
    client.document.findFirst.mockResolvedValue(
      docRow({ ownerType: 'LEAVE_REQUEST', ownerId: 'lr-1' }),
    );
    await expect(service.setCategory('doc-1', 'ID_PROOF', actor())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(client.document.update).not.toHaveBeenCalled();
  });
});

describe('DocumentsService.attachmentsFor', () => {
  it('maps live attachments by owner id and skips the query for no ids', async () => {
    const { service, client } = build();
    await expect(service.attachmentsFor('LEAVE_REQUEST', [])).resolves.toEqual(new Map());
    expect(client.document.findMany).not.toHaveBeenCalled();

    client.document.findMany.mockResolvedValue([
      docRow({ ownerType: 'LEAVE_REQUEST', ownerId: 'lr-1' }),
    ]);
    const map = await service.attachmentsFor('LEAVE_REQUEST', ['lr-1', 'lr-2']);
    expect(client.document.findMany).toHaveBeenCalledWith({
      where: { ownerType: 'LEAVE_REQUEST', ownerId: { in: ['lr-1', 'lr-2'] }, deletedAt: null },
    });
    expect(map.get('lr-1')?.id).toBe('doc-1');
    expect(map.has('lr-2')).toBe(false);
  });
});
