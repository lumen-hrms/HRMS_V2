/**
 * Runs `fn` over `items` with at most `limit` in flight, preserving result
 * order. The first rejection stops scheduling new work and is rethrown once
 * the in-flight calls settle — same fail-the-run semantics as a plain
 * sequential loop, just without paying one network round-trip at a time
 * (payslip PDF upload / notification enqueue at 5,000 employees).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failure: { error: unknown } | null = null;

  async function worker(): Promise<void> {
    while (failure === null) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (error) {
        failure ??= { error };
        return;
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  await Promise.all(workers);
  if (failure !== null) throw (failure as { error: unknown }).error;
  return results;
}
