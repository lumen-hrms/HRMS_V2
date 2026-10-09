import { mapWithConcurrency } from './concurrency.util';

describe('mapWithConcurrency', () => {
  it('preserves result order', async () => {
    const out = await mapWithConcurrency([30, 5, 20, 1], 3, async (n) => {
      await new Promise((r) => setTimeout(r, n));
      return n * 2;
    });
    expect(out).toEqual([60, 10, 40, 2]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 40 }, (_, i) => i),
      4,
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight -= 1;
      },
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('handles empty input and limits larger than the list', async () => {
    expect(await mapWithConcurrency([], 5, async () => 1)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 50, async (n) => n)).toEqual([1, 2]);
  });

  it('rethrows the first failure and stops scheduling new work', async () => {
    const started: number[] = [];
    await expect(
      mapWithConcurrency(
        Array.from({ length: 100 }, (_, i) => i),
        2,
        async (n) => {
          started.push(n);
          await new Promise((r) => setTimeout(r, 1));
          if (n === 3) throw new Error('boom');
        },
      ),
    ).rejects.toThrow('boom');
    expect(started.length).toBeLessThan(100);
  });
});
