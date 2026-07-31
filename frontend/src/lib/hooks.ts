'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import type { Lookup, LookupValue } from './types';

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

/**
 * The ACTIVE values of a lookup, found by its code (e.g. 'DISCOUNT_LEVEL').
 *
 * Values live one level below the lookup itself, so reaching them means finding
 * the lookup by code first and then fetching its values — two calls that every
 * screen using a lookup-driven list would otherwise repeat. An unknown code
 * yields an empty list rather than an error: a lookup the user has deleted
 * should leave a screen empty, not broken.
 *
 * Sorted by the lookup's own sortOrder, so the order shown is the order the
 * user arranged in Lookups.
 */
export function useLookupValues(code: string) {
  const { data: lookups } = useFetch<Lookup[]>('/lookups');
  const [values, setValues] = useState<LookupValue[]>([]);

  useEffect(() => {
    const lookup = (lookups ?? []).find((l) => l.code === code);
    if (!lookup) {
      setValues([]);
      return;
    }
    let cancelled = false;
    api
      .get<LookupValue[]>(`/lookups/${lookup.id}/values`)
      .then((vals) => {
        if (cancelled) return;
        setValues(
          (vals ?? [])
            .filter((v) => v.isActive)
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
        );
      })
      .catch(() => {
        if (!cancelled) setValues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [lookups, code]);

  return values;
}
