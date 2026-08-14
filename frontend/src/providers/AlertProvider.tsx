'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from '@/lib/api';
import { useEventStream } from '@/lib/useEventStream';
import type { Alert, AlertPage } from '@/lib/types';

/** How many alerts the bell holds. The Alerts screen pages properly. */
const BELL_SIZE = 20;

/**
 * Safety net behind the stream. The stream is the real delivery path; this is
 * for the case where a proxy between here and the backend quietly eats
 * text/event-stream, which is common enough that a bell depending on it alone
 * would be silently wrong for some deployments and not others.
 */
const POLL_MS = 60_000;

interface AlertContextValue {
  /** The live feed, newest first — what the bell shows. */
  alerts: Alert[];
  /** Unread, still standing, not put down. The badge. */
  unread: number;
  loading: boolean;
  /** Bumped on every stream event, so a screen can refetch its own view. */
  version: number;
  refresh: () => Promise<void>;
  markRead: (id: number) => Promise<void>;
  markAllRead: () => Promise<void>;
  dismiss: (id: number) => Promise<void>;
}

const AlertContext = createContext<AlertContextValue | null>(null);

/**
 * The reader's side of alerts (SRS §8.11, FR-COM-05), in one place.
 *
 * Two things read alerts — the topbar bell and the Alerts screen — and they must
 * agree: a badge that says three while the screen shows one is worse than no
 * badge. So there is ONE subscription and one feed here, and both mount under
 * it. It also means one stream per tab rather than one per component.
 *
 * Everything is optimistic and then reconciled: marking read decrements the
 * badge immediately and the server is told afterwards, because the alternative
 * is a bell that lags every click by a round trip. A failed call leaves the
 * server's count to win at the next poll.
 */
export function AlertProvider({ children }: { children: React.ReactNode }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [page, count] = await Promise.all([
        api.get<AlertPage>(`/notifications?pageSize=${BELL_SIZE}`),
        api.get<{ count: number }>('/notifications/unread-count'),
      ]);
      setAlerts(page.items);
      setUnread(count.count);
    } catch {
      // A transient or unauthorized fetch must not disrupt the shell.
    } finally {
      setLoading(false);
    }
  }, []);

  // Held in a ref so the stream's callbacks never re-subscribe when it changes.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refreshRef.current(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEventStream(
    '/notifications/stream',
    useCallback((event) => {
      setVersion((v) => v + 1);
      if (event.type === 'alert.new') {
        const alert = event.data as Alert;
        setAlerts((list) =>
          // Guard against a double delivery (two events, or an event racing the
          // poll): an alert appearing twice in the bell would double the badge.
          list.some((a) => a.id === alert.id)
            ? list
            : [alert, ...list].slice(0, BELL_SIZE),
        );
        setUnread((n) => n + 1);
        return;
      }
      if (event.type === 'alert.stale') {
        const { ids } = event.data as { ids: number[] };
        const gone = new Set(ids);
        setAlerts((list) => {
          // Only the ones that were still UNREAD were counted in the badge.
          const removed = list.filter((a) => gone.has(a.id) && !a.readAt);
          if (removed.length) setUnread((n) => Math.max(0, n - removed.length));
          return list.filter((a) => !gone.has(a.id));
        });
      }
    }, []),
    // A stream that reconnects has a gap behind it: whatever was raised while it
    // was down was never delivered.
    useCallback(() => void refreshRef.current(), []),
  );

  const markRead = useCallback(async (id: number) => {
    setAlerts((list) =>
      list.map((a) =>
        a.id === id && !a.readAt
          ? { ...a, readAt: new Date().toISOString() }
          : a,
      ),
    );
    setUnread((n) => Math.max(0, n - 1));
    try {
      await api.post(`/notifications/${id}/read`);
    } catch {
      void refreshRef.current();
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setAlerts((list) =>
      list.map((a) => (a.readAt ? a : { ...a, readAt: now })),
    );
    setUnread(0);
    try {
      await api.post('/notifications/read-all');
    } catch {
      void refreshRef.current();
    }
  }, []);

  const dismiss = useCallback(async (id: number) => {
    setAlerts((list) => {
      const target = list.find((a) => a.id === id);
      if (target && !target.readAt) setUnread((n) => Math.max(0, n - 1));
      return list.filter((a) => a.id !== id);
    });
    try {
      await api.post(`/notifications/${id}/dismiss`);
    } catch {
      void refreshRef.current();
    }
    // The bell holds twenty; putting one down should reveal the twenty-first
    // rather than leave a shorter list.
    void refreshRef.current();
  }, []);

  const value = useMemo(
    () => ({
      alerts,
      unread,
      loading,
      version,
      refresh,
      markRead,
      markAllRead,
      dismiss,
    }),
    [alerts, unread, loading, version, refresh, markRead, markAllRead, dismiss],
  );

  return (
    <AlertContext.Provider value={value}>{children}</AlertContext.Provider>
  );
}

/**
 * Read the alert feed. Returns null outside the provider rather than throwing —
 * the login screen renders no shell, and a hook that throws there would take the
 * page with it.
 */
export function useAlerts(): AlertContextValue | null {
  return useContext(AlertContext);
}
