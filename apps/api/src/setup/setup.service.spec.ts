import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SetupService } from './setup.service';
import { EmployeeImportService } from '../employees/employee-import.service';
import { validDraft } from './setup.test-fixtures';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import type { SetupDraft } from './setup.types';

const actor = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  sub: 'user-ca',
  tenantId: 'tenant-1',
  role: 'COMPANY_ADMIN',
  email: 'founder@acme.example',
  employeeId: null,
  ...overrides,
});

const enc = (draft: SetupDraft) => `enc:${JSON.stringify(draft)}`;

/** An employee file as `readSpreadsheet` would have stored it (normalized headers). */
const employeeFile = (rows: Record<string, string>[]) => ({
  fileName: 'employees.csv',
  uploadedAt: '2026-10-20T00:00:00.000Z',
  headers: [
    'employeecode',
    'firstname',
    'lastname',
    'department',
    'reportingmanagercode',
    'loginemail',
  ],
  rows: rows.map((values, i) => ({ row: i + 2, values })),
});

function build(opts: { setup?: Record<string, unknown> | null; txFails?: boolean } = {}) {
  let setupRow: any = opts.setup === undefined ? null : opts.setup;
  const client: any = {
    tenantSetup: {
      findUnique: jest.fn(async () => setupRow),
      upsert: jest.fn(async ({ update, create }: any) => {
        setupRow = setupRow ? { ...setupRow, ...update } : { ...create };
        return setupRow;
      }),
      update: jest.fn(async ({ data }: any) => {
        setupRow = { ...setupRow, ...data };
        return setupRow;
      }),
    },
    salaryStructure: { count: jest.fn().mockResolvedValue(0) },
    tenantSettings: {
      findUnique: jest.fn().mockResolvedValue({ fyStartMonth: 4, weeklyOffDays: [0, 6] }),
    },
    attendanceSettings: { findUnique: jest.fn().mockResolvedValue(null) },
    companyProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    department: {
      findMany: jest.fn().mockResolvedValue([{ id: 'dept-saved', name: 'Operations', code: null }]),
    },
    shift: { findMany: jest.fn().mockResolvedValue([{ id: 'shift-saved' }]) },
    holiday: { findMany: jest.fn().mockResolvedValue([]) },
    leaveType: { findMany: jest.fn().mockResolvedValue([]) },
    employee: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([{ email: 'founder@acme.example' }]),
      create: jest.fn(async ({ data }: any) => ({ id: `user-${data.email}`, ...data })),
    },
    payrollRun: { findMany: jest.fn().mockResolvedValue([]) },
    leaveBalance: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    auditLog: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const tenantPrisma = { tenantId: 'tenant-1', client };

  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    // Same row the request-scoped client reads: the claim and the final update land on it.
    tenantSetup: {
      updateMany: jest.fn(async ({ data }: any) => {
        setupRow = { ...setupRow, ...data };
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }: any) => {
        setupRow = { ...setupRow, ...data };
        return setupRow;
      }),
    },
    companyProfile: { upsert: jest.fn().mockResolvedValue({}) },
    tenantSettings: { upsert: jest.fn().mockResolvedValue({}) },
    attendanceSettings: { upsert: jest.fn().mockResolvedValue({}) },
    department: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }: any) => ({ id: `dept-${data.name}`, ...data })),
    },
    shift: {
      create: jest.fn(async ({ data }: any) => ({ id: `shift-${data.name}`, ...data })),
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    holiday: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    leaveType: {
      create: jest.fn(async ({ data }: any) => ({ id: `type-${data.code}`, ...data })),
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    employee: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }: any) => ({ id: 'emp-admin', ...data })),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
    },
    leaveBalance: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    leaveLedgerEntry: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  if (opts.txFails) tx.leaveType.create.mockRejectedValue(new Error('connection reset'));
  const raw = { $transaction: jest.fn(async (fn: any) => fn(tx)) };

  const fieldEncryption = {
    encrypt: jest.fn((v: string) => `enc:${v}`),
    decrypt: jest.fn((v: string) => v.slice(4)),
  };
  const firebaseAuth = {
    getUserByEmail: jest.fn(async () => {
      throw { code: 'auth/user-not-found' };
    }),
    createUser: jest.fn(async ({ email }: any) => ({ uid: `fb-${email}` })),
    setCustomUserClaims: jest.fn().mockResolvedValue(undefined),
    deleteUser: jest.fn().mockResolvedValue(undefined),
  };
  const audit = {
    log: jest.fn().mockResolvedValue(undefined),
    logMany: jest.fn().mockResolvedValue(undefined),
  };
  const authEmails = { sendPasswordReset: jest.fn().mockResolvedValue('ses') };
  const entitlement = {
    applyPolicyDefaults: jest.fn().mockResolvedValue({ credited: 3, balancesCreated: 3 }),
  };
  const importer = new EmployeeImportService(
    tenantPrisma as any,
    fieldEncryption as any,
    firebaseAuth as any,
    audit as any,
    authEmails as any,
    entitlement as any,
  );
  const service = new SetupService(
    tenantPrisma as any,
    raw as any,
    fieldEncryption as any,
    importer,
    entitlement as any,
    audit as any,
    authEmails as any,
    firebaseAuth as any,
  );
  return {
    service,
    client,
    tx,
    raw,
    firebaseAuth,
    audit,
    entitlement,
    authEmails,
    getSetup: () => setupRow,
  };
}

describe('SetupService', () => {
  describe('getStatus', () => {
    it('reports incomplete with no setup row, and never counts payroll then', async () => {
      const { service, client } = build();
      await expect(service.getStatus()).resolves.toMatchObject({
        complete: false,
        payrollConfigured: false,
      });
      expect(client.salaryStructure.count).not.toHaveBeenCalled();
    });

    it('reports complete with pending login failures', async () => {
      const failures = [{ employeeCode: 'E1', email: 'e1@x', role: 'EMPLOYEE', error: 'boom' }];
      const { service, client } = build({
        setup: { completedAt: new Date(), result: { loginFailures: failures } },
      });
      client.salaryStructure.count.mockResolvedValue(2);
      await expect(service.getStatus()).resolves.toMatchObject({
        complete: true,
        payrollConfigured: true,
        loginFailures: failures,
      });
    });
  });

  describe('getDraft', () => {
    it('prefills a new tenant with its saved rows and the suggested leave policy', async () => {
      const { service } = build();
      const { draft, files } = await service.getDraft(actor(), 'Acme');

      expect(draft.company.legalName).toBe('Acme');
      expect(draft.company.contactEmail).toBe('founder@acme.example');
      expect(draft.departments).toEqual([
        { existingId: 'dept-saved', name: 'Operations', code: '' },
      ]);
      expect(draft.leavePolicy.types.map((t) => t.code)).toEqual([
        'CL',
        'SL',
        'EL',
        'RH', // accrued
        'ML',
        'AL',
        'CML',
        'MCL',
        'PL',
        'MRL', // event-based presets
      ]);
      expect(files).toEqual({ employees: null, balances: null });
    });

    it('never sends uploaded rows back to the browser', async () => {
      const stored = validDraft({ employeeFile: employeeFile([{ employeecode: 'E1' }]) });
      const { service } = build({ setup: { draftCiphertext: enc(stored) } });
      const result = await service.getDraft(actor(), 'Acme');

      expect((result.draft as any).employeeFile).toBeUndefined();
      expect(result.files.employees).toEqual({
        fileName: 'employees.csv',
        uploadedAt: '2026-10-20T00:00:00.000Z',
        rowCount: 1,
      });
    });

    it('refuses once setup is complete', async () => {
      const { service } = build({ setup: { completedAt: new Date() } });
      await expect(service.getDraft(actor(), 'Acme')).rejects.toThrow(BadRequestException);
    });
  });

  describe('saveDraft', () => {
    it('drops ids the server never handed out and keeps saved departments from the DB', async () => {
      const { service, getSetup } = build();
      const incoming = validDraft({
        departments: [{ existingId: 'dept-saved', name: 'Renamed by browser' }, { name: 'Sales' }],
        shifts: [{ ...validDraft().shifts[0], existingId: 'forged-id' }],
      });

      await service.saveDraft(actor(), incoming);

      const saved: SetupDraft = JSON.parse(getSetup().draftCiphertext.slice(4));
      expect(saved.departments).toEqual([
        { existingId: 'dept-saved', name: 'Operations', code: '' },
        { name: 'Sales' },
      ]);
      expect(saved.shifts[0].existingId).toBeUndefined();
    });

    it('ignores new department rows left completely blank', async () => {
      const { service, getSetup } = build();
      const incoming = validDraft({
        departments: [{ name: 'Sales' }, { name: '  ' }, { name: '', code: '' }],
      });

      await service.saveDraft(actor(), incoming);

      const saved: SetupDraft = JSON.parse(getSetup().draftCiphertext.slice(4));
      expect(saved.departments).toEqual([
        { existingId: 'dept-saved', name: 'Operations', code: '' },
        { name: 'Sales' },
      ]);
    });

    it('returns the validation of what it saved, without the internal plan', async () => {
      const { service } = build();

      const res = await service.saveDraft(actor(), validDraft());

      expect(res.savedAt).toBeInstanceOf(Date);
      expect(res.validation.issues.filter((i) => i.level === 'error')).toEqual([]);
      expect(res.validation).not.toHaveProperty('planned');
      expect(res.validation).not.toHaveProperty('balances');
    });

    it('stores the draft encrypted, never as plain JSON', async () => {
      const { service, getSetup } = build();
      await service.saveDraft(actor(), validDraft());
      expect(getSetup().draftCiphertext.startsWith('enc:')).toBe(true);
    });

    it('keeps the stored files whatever the browser sends', async () => {
      const file = employeeFile([{ employeecode: 'E1' }]);
      const { service, getSetup } = build({
        setup: { draftCiphertext: enc(validDraft({ employeeFile: file })) },
      });

      await service.saveDraft(actor(), { ...validDraft(), employeeFile: null } as any);

      expect(JSON.parse(getSetup().draftCiphertext.slice(4)).employeeFile).toEqual(file);
    });

    it('marks the profile as belonging to whoever last edited it', async () => {
      const { service, getSetup } = build({ setup: { draftCiphertext: enc(validDraft()) } });
      const edited = validDraft();
      edited.profile.firstName = 'Someone else';

      await service.saveDraft(actor({ sub: 'user-ca2' }), edited);

      expect(JSON.parse(getSetup().draftCiphertext.slice(4)).profile.forUserId).toBe('user-ca2');
    });

    it('refuses once setup is complete', async () => {
      const { service } = build({ setup: { completedAt: new Date() } });
      await expect(service.saveDraft(actor(), validDraft())).rejects.toThrow(ForbiddenException);
    });
  });

  describe('employee file validation', () => {
    it('is strict about departments and refuses the admin’s own code', async () => {
      const draft = validDraft({
        employeeFile: employeeFile([
          { employeecode: 'E1', firstname: 'A', lastname: 'One', department: 'Engineering' },
          { employeecode: 'E2', firstname: 'B', lastname: 'Two', department: 'Sales' },
          { employeecode: 'ACME-001', firstname: 'Me', lastname: 'Again' },
        ]),
      });
      const { service } = build({ setup: { draftCiphertext: enc(draft) } });

      const result = await service.validate(actor());

      expect(result.ok).toBe(false);
      expect(result.employeeReport!.results.map((r) => r.success)).toEqual([true, false, false]);
      expect(result.issues.filter((i) => i.step === 'employees').map((i) => i.message)).toEqual([
        expect.stringMatching(/"Sales" isn't in your departments list/),
        expect.stringMatching(/your own profile/),
      ]);
    });
  });

  describe('submit', () => {
    it('refuses a draft with errors and writes nothing', async () => {
      const draft = validDraft({ departments: [] });
      const { service, raw } = build({ setup: { draftCiphertext: enc(draft) } });

      await expect(service.submit(actor())).rejects.toThrow(BadRequestException);
      expect(raw.$transaction).not.toHaveBeenCalled();
    });

    it('refuses when the profile was filled in by another admin', async () => {
      const draft = validDraft();
      draft.profile.forUserId = 'user-ca2';
      const { service, raw } = build({ setup: { draftCiphertext: enc(draft) } });

      await expect(service.submit(actor())).rejects.toThrow(BadRequestException);
      expect(raw.$transaction).not.toHaveBeenCalled();
    });

    it('writes everything in one transaction, managers before reports, then provisions logins', async () => {
      const draft = validDraft({
        employeeFile: employeeFile([
          {
            employeecode: 'E2',
            firstname: 'B',
            lastname: 'Two',
            department: 'Engineering',
            reportingmanagercode: 'E1',
            loginemail: 'b@acme.example',
          },
          {
            employeecode: 'E1',
            firstname: 'A',
            lastname: 'One',
            department: 'Engineering',
            reportingmanagercode: 'ACME-001',
          },
        ]),
        openingBalanceFile: {
          fileName: 'balances.csv',
          uploadedAt: '2026-10-20T00:00:00.000Z',
          headers: ['employeecode', 'leavetypecode', 'openingbalance'],
          rows: [
            { row: 2, values: { employeecode: 'E1', leavetypecode: 'EL', openingbalance: '6.5' } },
          ],
        },
      });
      const { service, tx, raw, firebaseAuth, client, audit, entitlement } = build({
        setup: { draftCiphertext: enc(draft) },
      });

      const result = await service.submit(actor());

      expect(raw.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.tenantSetup.updateMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', completedAt: null },
        data: expect.objectContaining({ completedBy: 'user-ca' }),
      });
      expect(tx.tenantSettings.upsert.mock.calls[0][0].update).toMatchObject({
        fyStartMonth: 4,
        goLiveDate: new Date('2026-10-01'),
      });
      // The admin's own record, linked to their login.
      expect(tx.employee.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-ca',
          employeeCode: 'ACME-001',
          departmentId: 'dept-Leadership',
        }),
      });
      // Manager-first: E1 (reports to the admin) is inserted before E2 (reports to E1).
      const rows = tx.employee.createMany.mock.calls[0][0].data;
      expect(rows.map((r: any) => r.employeeCode)).toEqual(['E1', 'E2']);
      expect(rows[0].reportingManagerId).toBe('emp-admin');
      expect(rows[1].reportingManagerId).toBe(rows[0].id);
      // Opening balance + its ledger entry, then policy defaults inside the same transaction.
      expect(tx.leaveBalance.createMany.mock.calls[0][0].data).toEqual([
        expect.objectContaining({
          employeeId: rows[0].id,
          leaveTypeId: 'type-EL',
          accrued: 6.5,
          year: 2026,
        }),
      ]);
      expect(tx.leaveLedgerEntry.createMany.mock.calls[0][0].data[0]).toMatchObject({
        source: 'OPENING_BALANCE',
      });
      expect(entitlement.applyPolicyDefaults).toHaveBeenCalledWith(
        tx,
        'tenant-1',
        expect.any(Date),
      );
      // Exactly one default shift.
      expect(tx.shift.update).toHaveBeenLastCalledWith({
        where: { id: 'shift-General' },
        data: { isDefault: true },
      });
      // After the commit: the login, then the audit trail.
      expect(firebaseAuth.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'b@acme.example' }),
      );
      expect(client.employee.update).toHaveBeenCalledWith({
        where: { id: rows[1].id },
        data: { userId: 'user-b@acme.example' },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'tenant.setup_completed' }),
      );
      expect(result).toMatchObject({ complete: true, loginFailures: [] });
      expect(result.counts).toMatchObject({ employeesCreated: 2, openingBalances: 1, logins: 1 });
    });

    it('leaves nothing behind when the transaction fails: no logins, no audit', async () => {
      const { service, firebaseAuth, audit } = build({
        setup: {
          draftCiphertext: enc(
            validDraft({
              employeeFile: employeeFile([
                {
                  employeecode: 'E1',
                  firstname: 'A',
                  lastname: 'One',
                  loginemail: 'a@acme.example',
                },
              ]),
            }),
          ),
        },
        txFails: true,
      });

      await expect(service.submit(actor())).rejects.toThrow('connection reset');
      expect(firebaseAuth.createUser).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('refuses a second submit that lost the race for the setup row', async () => {
      const { service, tx } = build({ setup: { draftCiphertext: enc(validDraft()) } });
      tx.tenantSetup.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.submit(actor())).rejects.toThrow(/already complete/);
      expect(tx.companyProfile.upsert).not.toHaveBeenCalled();
    });

    it('records a failed login instead of failing the submit, and retries it later', async () => {
      const draft = validDraft({
        employeeFile: employeeFile([
          { employeecode: 'E1', firstname: 'A', lastname: 'One', loginemail: 'a@acme.example' },
        ]),
      });
      const { service, firebaseAuth, client, getSetup } = build({
        setup: { draftCiphertext: enc(draft) },
      });
      firebaseAuth.createUser.mockRejectedValueOnce(new Error('identity provider down'));

      const result = await service.submit(actor());

      expect(result.loginFailures).toEqual([
        expect.objectContaining({
          employeeCode: 'E1',
          email: 'a@acme.example',
          error: 'identity provider down',
        }),
      ]);
      expect(getSetup().result.loginFailures).toHaveLength(1);

      client.employee.findFirst.mockResolvedValue({ id: 'emp-e1', userId: null });
      const retried = await service.retryLogins(actor());

      expect(retried.loginFailures).toEqual([]);
      expect(client.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp-e1' },
        data: { userId: 'user-a@acme.example' },
      });
    });
  });
});
