import {
  backgroundWorkersEnabled,
  PAUSED_WORKER,
  startBackgroundWorker,
} from './background-workers';

describe('backgroundWorkersEnabled', () => {
  it.each([
    [{ WORKERS_ENABLED: 'true', NODE_ENV: 'development' }, true],
    [{ WORKERS_ENABLED: '1' }, true],
    [{ WORKERS_ENABLED: ' FALSE ', NODE_ENV: 'production' }, false],
    [{ WORKERS_ENABLED: '0' }, false],
    // Unset → on everywhere except a laptop's `npm run dev`.
    [{ NODE_ENV: 'development' }, false],
    [{ NODE_ENV: 'production' }, true],
    [{ NODE_ENV: 'test' }, true],
    [{}, true],
    // Garbage falls back to the NODE_ENV rule rather than guessing.
    [{ WORKERS_ENABLED: 'maybe', NODE_ENV: 'development' }, false],
  ])('%j → %s', (env, expected) => {
    expect(backgroundWorkersEnabled(env as NodeJS.ProcessEnv)).toBe(expected);
  });
});

describe('startBackgroundWorker', () => {
  function host() {
    return { worker: { run: jest.fn().mockResolvedValue(undefined) } } as any;
  }

  it('starts the worker, then registers its schedules', async () => {
    const h = host();
    const schedules = jest.fn().mockResolvedValue(undefined);
    await expect(startBackgroundWorker(h, schedules, { NODE_ENV: 'production' })).resolves.toBe(
      true,
    );
    expect(h.worker.run).toHaveBeenCalledTimes(1);
    expect(schedules).toHaveBeenCalledTimes(1);
  });

  it('does neither when disabled — the queue is left completely alone', async () => {
    const h = host();
    const schedules = jest.fn();
    await expect(startBackgroundWorker(h, schedules, { WORKERS_ENABLED: 'false' })).resolves.toBe(
      false,
    );
    expect(h.worker.run).not.toHaveBeenCalled();
    expect(schedules).not.toHaveBeenCalled();
  });

  it('works for a worker with no schedule', async () => {
    const h = host();
    await startBackgroundWorker(h, undefined, {});
    expect(h.worker.run).toHaveBeenCalled();
  });

  it('every processor is created paused (autorun off) so nothing runs before this check', () => {
    expect(PAUSED_WORKER).toEqual({ autorun: false });
  });
});

describe('every BullMQ processor is registered paused', () => {
  // If one is missed it would run on every laptop again — see
  // background-workers.ts for why that corrupts the shared dev DB.
  const processors = [
    ['LeaveAccrualProcessor', '../leave/leave-accrual.processor'],
    ['LeaveEscalationProcessor', '../leave/leave-escalation.processor'],
    ['LoginAuditRetentionProcessor', '../access/login-audit-retention.processor'],
    ['DocumentScanProcessor', '../documents/document-scan.processor'],
    ['PlatformScheduledJobsProcessor', '../platform-admin/platform-scheduled-jobs.processor'],
    ['AttendanceFinalizationProcessor', '../attendance/attendance-finalization.processor'],
    ['NotificationSendProcessor', '../notifications/notification-send.processor'],
  ] as const;

  it.each(processors)('%s', (name, path) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cls = require(path)[name];
    expect(Reflect.getMetadata('bullmq:worker_metadata', cls)).toMatchObject({ autorun: false });
    expect(typeof cls.prototype.onApplicationBootstrap).toBe('function');
  });

  it('the list above covers every processor in src/', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execSync } = require('child_process');
    const found = execSync('grep -rl "extends WorkerHost" src --include=*.ts --exclude=*.spec.ts', {
      cwd: `${__dirname}/../..`,
    })
      .toString()
      .trim()
      .split('\n').length;
    expect(found).toBe(processors.length);
  });
});
