import { Logger } from '@nestjs/common';
import type { WorkerHost } from '@nestjs/bullmq';

/**
 * Every `@Processor` is registered with `autorun: false` and only starts in
 * `onApplicationBootstrap` if this says so — see `startBackgroundWorker`.
 *
 * Why: the dev database is shared by the whole team (CLAUDE.md), and several
 * jobs don't just process their own queue — they *scan the database* (the
 * documents/notifications sweeps, attendance finalization, leave accrual,
 * renewals, audit retention). A teammate's laptop running those would grab
 * rows that belong to the preview deploy and, lacking the preview's SES /
 * S3 / ClamAV config, mark them FAILED / SCAN_FAILED.
 *
 * - `WORKERS_ENABLED=true|false` decides explicitly.
 * - Unset: on everywhere except `NODE_ENV=development` (a laptop running
 *   `npm run dev`). The deploy workflow also passes `WORKERS_ENABLED=true`
 *   so the EC2 box never depends on what its .env says about NODE_ENV.
 */
export function backgroundWorkersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.WORKERS_ENABLED?.trim().toLowerCase();
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return env.NODE_ENV !== 'development';
}

/** Worker options for every `@Processor`: created paused, started by `startBackgroundWorker`. */
export const PAUSED_WORKER = { autorun: false } as const;

const logger = new Logger('BackgroundWorkers');

/**
 * Starts `host`'s BullMQ worker and then registers its repeatable jobs —
 * or does neither when workers are disabled. Call from
 * `onApplicationBootstrap` (the worker only exists after `onModuleInit`).
 * Returns whether it started.
 */
export async function startBackgroundWorker(
  host: WorkerHost,
  registerSchedules?: () => Promise<unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (!backgroundWorkersEnabled(env)) return false;
  // run() resolves only when the worker closes, so it isn't awaited.
  host.worker.run().catch((err) => {
    logger.error(`Worker ${host.constructor.name} stopped with an error`, err?.stack ?? err);
  });
  await registerSchedules?.();
  return true;
}
