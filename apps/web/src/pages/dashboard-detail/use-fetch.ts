import * as React from 'react';
import { api, isApiError } from '@/lib/api';

/**
 * GETs `path` (pass null to wait). While a new path loads, the previous data
 * stays in place and `loading` is true — so a chart can dim and keep its
 * frame instead of flashing a skeleton.
 */
export function useFetch<T>(path: string | null) {
  const [res, setRes] = React.useState<{ path: string; data: T | null; error: string | null } | null>(null);

  React.useEffect(() => {
    if (!path) return;
    let cancelled = false;
    api
      .get<T>(path)
      .then((data) => !cancelled && setRes({ path, data, error: null }))
      .catch((err) => {
        if (cancelled) return;
        setRes((prev) => ({
          path,
          data: prev?.data ?? null,
          error: isApiError(err) ? err.message : 'Could not load this data',
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const settled = !!path && res?.path === path;
  return {
    data: res?.data ?? null,
    error: settled ? res.error : null,
    loading: !!path && !settled,
  };
}
