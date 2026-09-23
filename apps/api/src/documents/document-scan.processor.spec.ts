import { DocumentScanProcessor } from './document-scan.processor';

jest.mock('../prisma/with-tenant-context', () => ({
  withTenantContext: (raw: any, tenantId: string) => raw.forTenant(tenantId),
}));

function docRow(overrides: Record<string, any> = {}) {
  return {
    id: 'doc-1',
    tenantId: 'tenant-1',
    employeeId: 'emp-1',
    ownerType: 'EMPLOYEE_PROFILE',
    ownerId: null,
    label: 'proof.pdf',
    storageKey: 'tenants/tenant-1/employees/emp-1/profile/x-proof.pdf',
    scanStatus: 'PENDING_SCAN',
    uploadedById: 'user-1',
    deletedAt: null,
    ...overrides,
  };
}

function build() {
  const client = {
    document: {
      findUnique: jest.fn().mockResolvedValue(docRow()),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const raw = { forTenant: jest.fn(() => client) };
  const queue = { add: jest.fn(), upsertJobScheduler: jest.fn() };
  const platform = {
    tenant: { findMany: jest.fn().mockResolvedValue([{ id: 'tenant-1' }, { id: 'tenant-2' }]) },
  };
  const storage = {
    download: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7')),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const scanner = { scan: jest.fn().mockResolvedValue({ clean: true }) };
  const processor = new DocumentScanProcessor(
    queue as any,
    platform as any,
    raw as any,
    storage as any,
    scanner as any,
  );
  return { processor, client, raw, queue, storage, scanner };
}

describe('DocumentScanProcessor.scanDocument', () => {
  const job = { tenantId: 'tenant-1', documentId: 'doc-1' };

  it('marks a clean file CLEAN under the job tenant context', async () => {
    const { processor, client, raw, storage } = build();
    await processor.scanDocument(job, false);
    expect(raw.forTenant).toHaveBeenCalledWith('tenant-1');
    expect(client.document.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { scanStatus: 'CLEAN', scannedAt: expect.any(Date), scanSignature: null },
    });
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('deletes the object, marks INFECTED and audits on a detection (RULE-3)', async () => {
    const { processor, client, storage, scanner } = build();
    scanner.scan.mockResolvedValue({ clean: false, signature: 'Eicar-Signature' });
    await processor.scanDocument(job, false);
    expect(storage.delete).toHaveBeenCalledWith(docRow().storageKey);
    expect(client.document.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: {
        scanStatus: 'INFECTED',
        scannedAt: expect.any(Date),
        scanSignature: 'Eicar-Signature',
      },
    });
    expect(client.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'documents.infected',
        targetId: 'doc-1',
        metadata: expect.objectContaining({ signature: 'Eicar-Signature' }),
      }),
    });
  });

  it('rethrows a scanner error so BullMQ retries, without changing state', async () => {
    const { processor, client, scanner } = build();
    scanner.scan.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(processor.scanDocument(job, false)).rejects.toThrow('ECONNREFUSED');
    expect(client.document.update).not.toHaveBeenCalled();
  });

  it('marks SCAN_FAILED on the final attempt and still rethrows (fail closed)', async () => {
    const { processor, client, storage } = build();
    storage.download.mockRejectedValue(new Error('NoSuchKey'));
    await expect(processor.scanDocument(job, true)).rejects.toThrow('NoSuchKey');
    expect(client.document.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { scanStatus: 'SCAN_FAILED' },
    });
  });

  it.each([
    ['already CLEAN', { scanStatus: 'CLEAN' }],
    ['already INFECTED', { scanStatus: 'INFECTED' }],
    ['soft-deleted', { deletedAt: new Date() }],
  ])('skips a document that is %s', async (_name, overrides) => {
    const { processor, client, scanner } = build();
    client.document.findUnique.mockResolvedValue(docRow(overrides));
    await processor.scanDocument(job, false);
    expect(scanner.scan).not.toHaveBeenCalled();
    expect(client.document.update).not.toHaveBeenCalled();
  });

  it('process() computes the final attempt from the job options', async () => {
    const { processor, storage, client } = build();
    storage.download.mockRejectedValue(new Error('boom'));
    await expect(
      processor.process({ name: 'scan', data: job, attemptsMade: 4, opts: { attempts: 5 } } as any),
    ).rejects.toThrow('boom');
    expect(client.document.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { scanStatus: 'SCAN_FAILED' },
    });
  });
});

describe('DocumentScanProcessor.sweep', () => {
  it('re-enqueues stale PENDING_SCAN and SCAN_FAILED documents in every tenant', async () => {
    const { processor, client, queue, raw } = build();
    client.document.findMany
      .mockResolvedValueOnce([{ id: 'doc-a' }])
      .mockResolvedValueOnce([{ id: 'doc-b' }]);
    const now = new Date('2026-09-23T10:00:00Z');

    await processor.sweep(now);

    expect(raw.forTenant).toHaveBeenCalledWith('tenant-1');
    expect(raw.forTenant).toHaveBeenCalledWith('tenant-2');
    expect(client.document.findMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        OR: [
          { scanStatus: 'PENDING_SCAN', uploadedAt: { lt: new Date('2026-09-23T09:50:00Z') } },
          { scanStatus: 'SCAN_FAILED' },
        ],
      },
      select: { id: true },
    });
    expect(queue.add).toHaveBeenCalledWith(
      'scan',
      { tenantId: 'tenant-1', documentId: 'doc-a' },
      expect.objectContaining({ jobId: 'scan-doc-a', removeOnFail: true }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'scan',
      { tenantId: 'tenant-2', documentId: 'doc-b' },
      expect.objectContaining({ jobId: 'scan-doc-b' }),
    );
  });
});
