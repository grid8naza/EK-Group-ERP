'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';

/**
 * Simple GET hook with manual refetch. Safe to use in client components.
 * It does not run during SSR (effect only fires in the browser).
 */
export function useFetch<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<T>(path);
      setData(res);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return; // redirect handled globally
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, refetch, setData };
}
