import {
  activityMetricEnabled,
  countRequest,
  publishOnce,
  resetCount,
  takeCount,
} from './activity-metric';

const hit = (url: string) => {
  const next = jest.fn();
  countRequest({ originalUrl: url } as any, {} as any, next);
  expect(next).toHaveBeenCalled();
};

describe('activity metric', () => {
  beforeEach(resetCount);

  it('counts real requests but not health checks', () => {
    hit('/api/employees');
    hit('/api/auth/session');
    hit('/api/health');
    hit('/api/health?x=1');
    expect(takeCount()).toBe(2);
  });

  it('takeCount resets, so an idle minute publishes 0', async () => {
    hit('/api/employees');
    const send = jest.fn().mockResolvedValue(undefined);
    await publishOnce(send);
    await publishOnce(send);
    expect(send).toHaveBeenNthCalledWith(1, 1);
    expect(send).toHaveBeenNthCalledWith(2, 0);
  });

  it('keeps the count when publishing fails (no lost activity)', async () => {
    hit('/api/employees');
    hit('/api/leave');
    await publishOnce(jest.fn().mockRejectedValue(new Error('throttled')));
    expect(takeCount()).toBe(2);
  });

  it('is off unless ACTIVITY_METRIC_ENABLED=true', () => {
    expect(activityMetricEnabled({})).toBe(false);
    expect(activityMetricEnabled({ ACTIVITY_METRIC_ENABLED: 'false' })).toBe(false);
    expect(activityMetricEnabled({ ACTIVITY_METRIC_ENABLED: 'TRUE ' })).toBe(true);
  });
});
