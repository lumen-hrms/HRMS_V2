import { BadRequestException, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import { AppLogger } from './app-logger';
import { describeAuditEvent, logAuditWrites } from './audit-event-log';
import { failureReason, requestLogging } from './request-logging';

describe('AppLogger', () => {
  let out: jest.SpyInstance;
  beforeEach(() => {
    process.env.NO_COLOR = '1';
    out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    out.mockRestore();
    delete process.env.NO_COLOR;
  });

  it('prints one Spring-style line: timestamp, level, pid, padded context, message', () => {
    new AppLogger().log('Tenant created', 'PlatformAdminService');
    const line = String(out.mock.calls[0][0]);
    expect(line).toMatch(
      new RegExp(
        `^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3}  INFO ${process.pid} --- \\[PlatformAdminService  \\] : Tenant created\\n$`,
      ),
    );
  });

  it('drops the framework startup chatter, but not its warnings', () => {
    const logger = new AppLogger();
    logger.log('Mapped {/api/x, GET} route', 'RouterExplorer');
    logger.log('AppModule dependencies initialized', 'InstanceLoader');
    expect(out).not.toHaveBeenCalled();
    logger.warn('something odd', 'RouterExplorer');
    expect(String(out.mock.calls[0][0])).toContain(' WARN ');
  });
});

describe('requestLogging', () => {
  function run(status: number, locals: Record<string, string> = {}) {
    const res = Object.assign(new EventEmitter(), { statusCode: status, locals }) as any;
    const req = {
      method: 'POST',
      originalUrl: '/api/leave/requests/abc/approve?x=1',
      baseUrl: '',
      route: { path: '/api/leave/requests/:id/approve' },
      user: { email: 'hr@acme.test' },
      tenantSubdomain: 'acme',
    } as any;
    const next = jest.fn();
    requestLogging(req, res, next);
    res.emit('finish');
    expect(next).toHaveBeenCalled();
  }
  let log: jest.SpyInstance, warn: jest.SpyInstance, error: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('logs a success at INFO with handler, route pattern, status, user and tenant', () => {
    run(200, { logHandlerName: 'LeaveController.approve' });
    expect(log.mock.calls[0][0]).toMatch(
      /^LeaveController\.approve POST \/api\/leave\/requests\/:id\/approve -> 200 \(\d+ ms\) user=hr@acme\.test tenant=acme$/,
    );
  });

  it('logs a 4xx at WARN and a 5xx at ERROR, with the failure reason', () => {
    run(400, { logFailureReason: 'Request is not pending approval' });
    expect(warn.mock.calls[0][0]).toMatch(/-> 400 .* — failed: Request is not pending approval$/);
    run(500);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('keeps ids and query strings out of the line', () => {
    run(200);
    expect(log.mock.calls[0][0]).not.toContain('abc');
    expect(log.mock.calls[0][0]).not.toContain('x=1');
  });
});

describe('failureReason', () => {
  it('uses an HTTP error’s message, joining validation lists', () => {
    expect(failureReason(new BadRequestException('Nope'))).toBe('Nope');
    expect(failureReason(new BadRequestException(['a is required', 'b too long']))).toBe(
      'a is required; b too long',
    );
  });

  it('names an unexpected error’s type without echoing its text', () => {
    expect(failureReason(new TypeError('secret detail'))).toBe('TypeError (see stack trace above)');
  });
});

describe('audit event log', () => {
  it('describes an event with only allow-listed metadata — never field values', () => {
    const line = describeAuditEvent({
      action: 'employee.updated',
      targetType: 'employee',
      targetId: 'e-1',
      metadata: {
        actorName: 'Hr Manager',
        fieldsChanged: ['ctc', 'bankAccount'],
        changes: { ctc: { from: 900000, to: 1200000 } },
        from: '900000',
      },
    });
    expect(line).toBe(
      'employee.updated employee:e-1 by Hr Manager (fieldsChanged=ctc, bankAccount)',
    );
    expect(line).not.toContain('900000');
  });

  it('shows from/to for status changes', () => {
    expect(
      describeAuditEvent({
        action: 'tenant.status_changed',
        targetType: 'tenant',
        targetId: 't-1',
        actorEmail: 'ops@hrms.dev',
        metadata: { tenantName: 'Acme', from: 'ACTIVE', to: 'SUSPENDED' },
      }),
    ).toBe(
      'tenant.status_changed tenant:t-1 by ops@hrms.dev (tenantName=Acme, from=ACTIVE, to=SUSPENDED)',
    );
  });

  it('logs audit rows and sign-ins as they are written, and ignores other models', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const mw = logAuditWrites();
    const next = async () => 'ok';
    await mw(
      {
        model: 'AuditLog',
        action: 'create',
        args: { data: { action: 'user.deactivated', targetType: 'user', targetId: 'u-1' } },
      } as any,
      next,
    );
    await mw(
      {
        model: 'AuditLog',
        action: 'createMany',
        args: { data: [{ action: 'employee.created' }, { action: 'employee.created' }] },
      } as any,
      next,
    );
    await mw(
      {
        model: 'LoginAuditEntry',
        action: 'create',
        args: { data: { outcome: 'SUCCESS', email: 'a@b.c' } },
      } as any,
      next,
    );
    await mw({ model: 'Employee', action: 'create', args: { data: {} } } as any, next);
    expect(log.mock.calls.map((c) => c[0])).toEqual([
      'user.deactivated user:u-1',
      '2 × employee.created',
      'sign-in SUCCESS for a@b.c',
    ]);
    log.mockRestore();
  });
});
