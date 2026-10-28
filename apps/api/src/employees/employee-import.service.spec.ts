import { EmployeeImportService } from './employee-import.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

const HEADER =
  'employeeCode,firstName,lastName,department,reportingManagerCode,workState,employmentType,dateOfJoining,pan,aadhaarLast4,bankAccountNumber,bankIfsc,loginEmail,loginRole';

const csv = (...rows: string[]) => Buffer.from([HEADER, ...rows].join('\n'), 'utf8');

/** A row in HEADER's column order; omitted fields are blank. */
function row(fields: Partial<Record<string, string>>) {
  return HEADER.split(',')
    .map((h) => fields[h] ?? '')
    .join(',');
}

function actor(role: AuthenticatedUser['role'] = 'COMPANY_ADMIN'): AuthenticatedUser {
  return {
    sub: 'user-admin',
    tenantId: 'tenant-1',
    role,
    email: 'admin@acme.test',
    employeeId: null,
  } as any;
}

function buildHarness(
  opts: {
    employees?: {
      id: string;
      employeeCode: string;
      reportingManagerId?: string | null;
      userId?: string | null;
    }[];
    departments?: { id: string; name: string }[];
    users?: { email: string }[];
    firebaseEmails?: string[];
  } = {},
) {
  const employees = (opts.employees ?? []).map((e) => ({
    reportingManagerId: null,
    userId: null,
    ...e,
  }));
  let seq = 0;
  const client: any = {
    employee: {
      findMany: jest.fn(async () => employees.map((e) => ({ ...e }))),
      // Mirrors Prisma's nested writes: `user: { create }` yields a userId.
      create: jest.fn(async ({ data }: any) => {
        const created = {
          id: `emp-${++seq}`,
          ...data,
          userId: data.user ? `user-${data.user.create.email}` : null,
        };
        employees.push(created);
        return created;
      }),
      update: jest.fn(async ({ where, data }: any) => ({
        id: where.id,
        ...data,
        userId: data.user ? `user-${data.user.create.email}` : null,
      })),
    },
    department: {
      findMany: jest.fn(async () => opts.departments ?? []),
      create: jest.fn(async ({ data }: any) => ({ id: `dept-${data.name}`, ...data })),
    },
    user: { findMany: jest.fn(async () => opts.users ?? []) },
    auditLog: { create: jest.fn(), createMany: jest.fn() },
  };
  const firebaseAuth = {
    getUserByEmail: jest.fn(async (email: string) => {
      if ((opts.firebaseEmails ?? []).includes(email)) return { uid: 'taken' };
      throw { code: 'auth/user-not-found' };
    }),
    createUser: jest.fn(async ({ email }: any) => ({ uid: `fb-${email}` })),
    setCustomUserClaims: jest.fn().mockResolvedValue(undefined),
    deleteUser: jest.fn().mockResolvedValue(undefined),
  };
  const fieldEncryption = { encrypt: jest.fn((v: string) => `enc:${v}`) };
  const audit = {
    log: jest.fn().mockResolvedValue(undefined),
    logMany: jest.fn().mockResolvedValue(undefined),
  };
  const authEmails = { sendPasswordReset: jest.fn().mockResolvedValue('ses') };
  const service = new EmployeeImportService(
    { tenantId: 'tenant-1', client } as any,
    fieldEncryption as any,
    firebaseAuth as any,
    audit as any,
    authEmails as any,
  );
  return { service, client, firebaseAuth, fieldEncryption, audit, authEmails };
}

describe('EmployeeImportService — dry run', () => {
  it('reports creates, updates and departments to be created, and writes nothing', async () => {
    const h = buildHarness({
      employees: [{ id: 'emp-existing', employeeCode: 'E1' }],
      departments: [{ id: 'dept-hr', name: 'HR' }],
    });
    const report = await h.service.import(
      csv(
        row({ employeeCode: 'E1', department: 'hr' }),
        row({ employeeCode: 'E2', firstName: 'Asha', lastName: 'Rao', department: 'AI / ML' }),
      ),
      actor(),
      true,
    );

    expect(report.dryRun).toBe(true);
    expect(report.succeeded).toBe(2);
    expect(report.summary).toMatchObject({ create: 1, update: 1, newDepartments: ['AI / ML'] });
    expect(report.results.map((r) => r.action)).toEqual(['update', 'create']);
    expect(h.client.employee.create).not.toHaveBeenCalled();
    expect(h.client.employee.update).not.toHaveBeenCalled();
    expect(h.client.department.create).not.toHaveBeenCalled();
    expect(h.firebaseAuth.createUser).not.toHaveBeenCalled();
    expect(h.audit.log).not.toHaveBeenCalled();
    expect(h.audit.logMany).not.toHaveBeenCalled();
  });

  it('validates every field and explains each failure', async () => {
    const h = buildHarness();
    const report = await h.service.import(
      csv(
        row({ employeeCode: 'E1' }), // new employee, no names
        row({ employeeCode: 'E2', firstName: 'A', lastName: 'B', pan: 'BAD' }),
        row({ employeeCode: 'E3', firstName: 'A', lastName: 'B', aadhaarLast4: '123412341234' }),
        row({ employeeCode: 'E4', firstName: 'A', lastName: 'B', dateOfJoining: '31-02-2026' }),
        row({ employeeCode: 'E5', firstName: 'A', lastName: 'B', workState: 'Atlantis' }),
        row({ employeeCode: 'E6', firstName: 'A', lastName: 'B', bankIfsc: 'nope' }),
        row({ employeeCode: '', firstName: 'A', lastName: 'B' }),
      ),
      actor(),
      true,
    );

    const err = (code: string | null) => report.results.find((r) => r.employeeCode === code)?.error;
    expect(err('E1')).toMatch(/firstName is required.*lastName is required/);
    expect(err('E2')).toMatch(/pan must look like/);
    expect(err('E3')).toMatch(/full Aadhaar number/);
    expect(err('E3')).not.toContain('123412341234'); // never echoed back
    expect(err('E4')).toMatch(/dateOfJoining "31-02-2026" is not a date/);
    expect(err('E5')).toMatch(/workState "Atlantis"/);
    expect(err('E6')).toMatch(/bankIfsc/);
    expect(err(null)).toBe('employeeCode is required');
    expect(report.succeeded).toBe(0);
  });

  it('accepts friendly spellings of enums and states', async () => {
    const h = buildHarness();
    const report = await h.service.import(
      csv(
        row({
          employeeCode: 'E1',
          firstName: 'A',
          lastName: 'B',
          workState: 'Tamil Nadu',
          employmentType: 'full time',
          dateOfJoining: '01/04/2026',
        }),
      ),
      actor(),
      false,
    );
    expect(report.succeeded).toBe(1);
    expect(h.client.employee.create.mock.calls[0][0].data).toMatchObject({
      workState: 'TAMIL_NADU',
      employmentType: 'FULL_TIME',
      dateOfJoining: new Date('2026-04-01'),
    });
  });

  it('fails every row that repeats an employee code', async () => {
    const h = buildHarness();
    const report = await h.service.import(
      csv(
        row({ employeeCode: 'E1', firstName: 'A', lastName: 'B' }),
        row({ employeeCode: 'E1', firstName: 'C', lastName: 'D' }),
      ),
      actor(),
      true,
    );
    expect(report.failed).toBe(2);
    expect(report.results[0].error).toMatch(/appears more than once \(rows 2, 3\)/);
  });
});

describe('EmployeeImportService — encryption key', () => {
  it('fails PAN/bank rows in the preview when the encryption key is missing, and leaves other rows valid', async () => {
    const h = buildHarness();
    h.fieldEncryption.encrypt.mockImplementation(() => {
      throw new Error('FIELD_ENCRYPTION_KEY is not configured.');
    });
    const report = await h.service.import(
      csv(
        row({ employeeCode: 'E1', firstName: 'A', lastName: 'B', pan: 'ABCDE1234F' }),
        row({
          employeeCode: 'E2',
          firstName: 'A',
          lastName: 'B',
          bankAccountNumber: '123456789012',
        }),
        row({ employeeCode: 'E3', firstName: 'A', lastName: 'B' }),
      ),
      actor(),
      true,
    );
    expect(report.results[0].error).toMatch(/FIELD_ENCRYPTION_KEY is not configured.*Leave pan/);
    expect(report.results[1].success).toBe(false);
    expect(report.results[2].success).toBe(true);
  });
});

describe('EmployeeImportService — reporting managers', () => {
  it('resolves a manager who appears later in the same file', async () => {
    const h = buildHarness();
    const report = await h.service.import(
      csv(
        row({ employeeCode: 'E2', firstName: 'Re', lastName: 'Port', reportingManagerCode: 'E1' }),
        row({ employeeCode: 'E1', firstName: 'Man', lastName: 'Ager' }),
      ),
      actor(),
      false,
    );
    expect(report.succeeded).toBe(2);
    // E2 is created as emp-1, E1 as emp-2; pass 2 links them.
    expect(h.client.employee.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { reportingManagerId: 'emp-2' },
    });
  });

  it('accepts an existing employee as manager', async () => {
    const h = buildHarness({ employees: [{ id: 'emp-boss', employeeCode: 'BOSS' }] });
    const report = await h.service.import(
      csv(row({ employeeCode: 'E1', firstName: 'A', lastName: 'B', reportingManagerCode: 'BOSS' })),
      actor(),
      false,
    );
    expect(report.succeeded).toBe(1);
    expect(h.client.employee.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { reportingManagerId: 'emp-boss' },
    });
  });

  it('fails an unknown manager, a self-manager, and a reporting cycle', async () => {
    const h = buildHarness({
      // Existing chain: E9 reports to E8.
      employees: [
        { id: 'emp-8', employeeCode: 'E8' },
        { id: 'emp-9', employeeCode: 'E9', reportingManagerId: 'emp-8' },
      ],
    });
    const report = await h.service.import(
      csv(
        row({ employeeCode: 'E1', firstName: 'A', lastName: 'B', reportingManagerCode: 'NOPE' }),
        row({ employeeCode: 'E2', firstName: 'A', lastName: 'B', reportingManagerCode: 'E2' }),
        row({ employeeCode: 'E8', reportingManagerCode: 'E9' }), // E8→E9→E8
      ),
      actor(),
      true,
    );
    const err = (code: string) => report.results.find((r) => r.employeeCode === code)?.error;
    expect(err('E1')).toMatch(/NOPE is not an existing employee/);
    expect(err('E2')).toMatch(/cannot be their own reporting manager/);
    expect(err('E8')).toMatch(/reporting cycle/);
  });

  it("fails a row whose manager's own row fails", async () => {
    const h = buildHarness();
    const report = await h.service.import(
      csv(
        row({ employeeCode: 'E1', firstName: 'A', lastName: 'B', reportingManagerCode: 'E2' }),
        row({ employeeCode: 'E2', firstName: 'A', lastName: 'B', pan: 'BAD' }),
      ),
      actor(),
      true,
    );
    expect(report.results[0].error).toMatch(/E2 is on row 3, which has errors/);
  });
});

describe('EmployeeImportService — commit', () => {
  it('encrypts PAN and bank account, stores only ciphertext + mask, and audits field names only', async () => {
    const h = buildHarness();
    await h.service.import(
      csv(
        row({
          employeeCode: 'E1',
          firstName: 'A',
          lastName: 'B',
          pan: 'abcde1234f',
          bankAccountNumber: '123456789012',
          aadhaarLast4: '0123',
        }),
      ),
      actor(),
      false,
    );

    const data = h.client.employee.create.mock.calls[0][0].data;
    expect(data.panCiphertext).toBe('enc:ABCDE1234F');
    expect(data.panMasked).not.toContain('ABCDE1234F');
    expect(data.bankAccountCiphertext).toBe('enc:123456789012');
    expect(data.aadhaarLast4).toBe('0123');
    expect(JSON.stringify(data)).not.toMatch(/"pan":|"bankAccountNumber":/);

    const rowAudit = h.audit.logMany.mock.calls[0][0].find(
      (a: any) => a.action === 'employee.created',
    );
    expect(rowAudit.metadata.fieldsChanged).toEqual(
      expect.arrayContaining(['pan', 'bankAccountNumber', 'aadhaarLast4']),
    );
    const audited = JSON.stringify([h.audit.log.mock.calls, h.audit.logMany.mock.calls]);
    expect(audited).not.toContain('ABCDE1234F');
    expect(audited).not.toContain('123456789012');
    expect(audited).not.toContain('Ciphertext');
  });

  it('on update, a blank cell leaves the field alone', async () => {
    const h = buildHarness({ employees: [{ id: 'emp-1', employeeCode: 'E1' }] });
    await h.service.import(
      csv(row({ employeeCode: 'E1', workState: 'KARNATAKA' })),
      actor(),
      false,
    );
    const { data } = h.client.employee.update.mock.calls[0][0];
    expect(data).toEqual({ workState: 'KARNATAKA' });
  });

  it('creates missing departments once and links rows to them', async () => {
    const h = buildHarness({ departments: [{ id: 'dept-hr', name: 'HR' }] });
    await h.service.import(
      csv(
        row({ employeeCode: 'E1', firstName: 'A', lastName: 'B', department: 'Legal' }),
        row({ employeeCode: 'E2', firstName: 'A', lastName: 'B', department: 'legal' }),
        row({ employeeCode: 'E3', firstName: 'A', lastName: 'B', department: 'HR' }),
      ),
      actor(),
      false,
    );
    expect(h.client.department.create).toHaveBeenCalledTimes(1);
    const depts = h.client.employee.create.mock.calls.map(
      (c: any) => c[0].data.department.connect.id,
    );
    expect(depts).toEqual(['dept-Legal', 'dept-Legal', 'dept-hr']);
  });

  it('a bad row never blocks the good ones', async () => {
    const h = buildHarness();
    const report = await h.service.import(
      csv(
        row({ employeeCode: 'E1', firstName: 'A', lastName: 'B' }),
        row({ employeeCode: 'E2', firstName: 'A', lastName: 'B', pan: 'BAD' }),
      ),
      actor(),
      false,
    );
    expect(report.succeeded).toBe(1);
    expect(report.failed).toBe(1);
    expect(h.client.employee.create).toHaveBeenCalledTimes(1);
  });
});

describe('EmployeeImportService — progress', () => {
  it('reports saving → linking → inviting progress, ending at each total', async () => {
    const h = buildHarness();
    const events: any[] = [];
    await h.service.import(
      csv(
        row({ employeeCode: 'E1', firstName: 'A', lastName: 'B', loginEmail: 'a@acme.test' }),
        row({ employeeCode: 'E2', firstName: 'A', lastName: 'B', reportingManagerCode: 'E1' }),
        row({ employeeCode: 'E3', firstName: 'A', lastName: 'B', pan: 'BAD' }),
      ),
      actor(),
      false,
      (p) => events.push(p),
    );
    const last = (phase: string) => events.filter((e) => e.phase === phase).pop();
    // Only the 2 valid rows are saved; 1 manager link; 1 invite.
    expect(last('saving')).toEqual({ phase: 'saving', done: 2, total: 2 });
    expect(last('linking')).toEqual({ phase: 'linking', done: 1, total: 1 });
    expect(last('inviting')).toEqual({ phase: 'inviting', done: 1, total: 1 });
    expect(events.map((e) => e.phase)).toEqual([
      'saving',
      'saving',
      'saving',
      'linking',
      'linking',
      'inviting',
      'inviting',
    ]);
  });

  it('writes rows in parallel, but never more than 4 at once', async () => {
    const h = buildHarness();
    let inFlight = 0;
    let peak = 0;
    const create = h.client.employee.create.getMockImplementation()!;
    h.client.employee.create.mockImplementation(async (args: any) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return create(args);
    });
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ employeeCode: `E${i}`, firstName: 'A', lastName: 'B' }),
    );
    const report = await h.service.import(csv(...rows), actor(), false);
    expect(report.succeeded).toBe(10);
    expect(peak).toBe(4);
  });
});

describe('EmployeeImportService — logins', () => {
  it('creates the login with claims + users row, then invites only after the employee lands', async () => {
    const h = buildHarness();
    const report = await h.service.import(
      csv(
        row({
          employeeCode: 'E1',
          firstName: 'A',
          lastName: 'B',
          loginEmail: 'A@Acme.test',
          loginRole: 'Line Manager',
        }),
      ),
      actor(),
      false,
    );
    expect(report.summary).toMatchObject({ logins: 1, invitesFailed: 0 });
    expect(h.firebaseAuth.setCustomUserClaims).toHaveBeenCalledWith('fb-a@acme.test', {
      tenantId: 'tenant-1',
      role: 'LINE_MANAGER',
    });
    // Employee + users row in one statement (nested create), so it's atomic.
    expect(h.client.employee.create.mock.calls[0][0].data.user).toEqual({
      create: {
        tenantId: 'tenant-1',
        email: 'a@acme.test',
        firebaseUid: 'fb-a@acme.test',
        role: 'LINE_MANAGER',
      },
    });
    expect(h.client.auditLog.createMany.mock.calls[0][0].data[0]).toMatchObject({
      targetId: 'user-a@acme.test',
    });
    expect(h.authEmails.sendPasswordReset).toHaveBeenCalledWith({
      email: 'a@acme.test',
      kind: 'INVITE',
      tenantId: 'tenant-1',
    });
    expect(h.authEmails.sendPasswordReset.mock.invocationCallOrder[0]).toBeGreaterThan(
      h.client.employee.create.mock.invocationCallOrder[0],
    );
  });

  it('an HR Manager cannot grant Company Admin', async () => {
    const h = buildHarness();
    const report = await h.service.import(
      csv(
        row({
          employeeCode: 'E1',
          firstName: 'A',
          lastName: 'B',
          loginEmail: 'a@acme.test',
          loginRole: 'COMPANY_ADMIN',
        }),
      ),
      actor('HR_MANAGER'),
      false,
    );
    expect(report.results[0].error).toMatch(/Only a Company Admin can grant/);
    expect(h.firebaseAuth.createUser).not.toHaveBeenCalled();
  });

  it('rejects a login email already in Firebase, in this workspace, or on an employee with a login', async () => {
    const h = buildHarness({
      employees: [{ id: 'emp-1', employeeCode: 'E1', userId: 'user-x' }],
      users: [{ email: 'taken@acme.test' }],
      firebaseEmails: ['elsewhere@acme.test'],
    });
    const report = await h.service.import(
      csv(
        row({ employeeCode: 'E1', loginEmail: 'new@acme.test' }),
        row({ employeeCode: 'E2', firstName: 'A', lastName: 'B', loginEmail: 'taken@acme.test' }),
        row({
          employeeCode: 'E3',
          firstName: 'A',
          lastName: 'B',
          loginEmail: 'elsewhere@acme.test',
        }),
      ),
      actor(),
      true,
    );
    expect(report.results.map((r) => r.error)).toEqual([
      'This employee already has a login',
      'loginEmail taken@acme.test is already used by another login in this workspace',
      'loginEmail elsewhere@acme.test is already registered with Firebase',
    ]);
  });

  it('deletes the Firebase login again when the DB write fails, and sends no invite', async () => {
    const h = buildHarness();
    h.client.employee.create.mockRejectedValueOnce(new Error('db down'));
    const report = await h.service.import(
      csv(row({ employeeCode: 'E1', firstName: 'A', lastName: 'B', loginEmail: 'a@acme.test' })),
      actor(),
      false,
    );
    expect(report.results[0]).toMatchObject({ success: false, error: 'db down' });
    expect(h.firebaseAuth.deleteUser).toHaveBeenCalledWith('fb-a@acme.test');
    expect(h.authEmails.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('a failed invite is a warning, not a failed row', async () => {
    const h = buildHarness();
    h.authEmails.sendPasswordReset.mockRejectedValue(new Error('SES throttled'));
    const report = await h.service.import(
      csv(row({ employeeCode: 'E1', firstName: 'A', lastName: 'B', loginEmail: 'a@acme.test' })),
      actor(),
      false,
    );
    expect(report.results[0].success).toBe(true);
    expect(report.results[0].warnings?.[0]).toMatch(/invite email failed/);
    expect(report.summary).toMatchObject({ invitesFailed: 1 });
  });
});
