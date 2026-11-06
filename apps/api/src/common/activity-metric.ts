import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Idle-detection signal for the on-demand EC2 box (docs/EC2_POWER.md): the
 * start/stop Lambda stops the instance after 30 minutes with no real traffic.
 * Network/CPU can't tell, the box is never truly idle (DB connection, BullMQ
 * polling, sweeps), so the API reports how many requests it served.
 *
 * Health checks are not activity. Zeros are published too, so an idle box
 * shows "0" instead of "no data" (the Lambda never stops on missing data).
 * Off unless `ACTIVITY_METRIC_ENABLED=true`.
 */
export const HEALTH_PATH = '/api/health';

let count = 0;

export function countRequest(req: Request, _res: Response, next: NextFunction): void {
  if (!req.originalUrl.startsWith(HEALTH_PATH)) count++;
  next();
}

/** Returns the count since the last call and resets it. */
export function takeCount(): number {
  const n = count;
  count = 0;
  return n;
}

export function resetCount(): void {
  count = 0;
}

export function activityMetricEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ACTIVITY_METRIC_ENABLED?.trim().toLowerCase() === 'true';
}

type Send = (value: number) => Promise<unknown>;

/** One publish tick: sends the count; on failure puts it back so nothing is lost. */
export async function publishOnce(send: Send): Promise<void> {
  const n = takeCount();
  try {
    await send(n);
  } catch {
    count += n;
  }
}

export function startActivityMetric(env: NodeJS.ProcessEnv = process.env): void {
  if (!activityMetricEnabled(env)) return;
  const logger = new Logger('ActivityMetric');
  const cw = new CloudWatchClient({ region: env.ACTIVITY_METRIC_REGION ?? 'ap-south-2' });
  const send: Send = (value) =>
    cw.send(
      new PutMetricDataCommand({
        Namespace: 'HRMS',
        MetricData: [{ MetricName: 'ApiRequests', Value: value, Unit: 'Count' }],
      }),
    );
  setInterval(() => void publishOnce(send), 60_000).unref();
  logger.log('Publishing HRMS/ApiRequests every 60s (drives idle auto-stop)');
}
