'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Archive,
  BellOff,
  Building2,
  Check,
  CheckCheck,
  ExternalLink,
  Settings2,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { DOC_PARAM } from '@/lib/hooks';
import { useAuth } from '@/providers/AuthProvider';
import { useAlerts } from '@/providers/AlertProvider';
import { useToast } from '@/providers/ToastProvider';
import { Tabs } from '@/components/ui/Tabs';
import { dayLabel, fullTime } from '@/components/workplace/people';
import {
  CATEGORY_ORDER,
  PRIORITY_ROW,
  PRIORITY_TAG,
  categoryMeta,
} from '@/components/workplace/alert-ui';
import { cn } from '@/lib/utils';
import type {
  Alert,
  AlertCategory,
  AlertPage,
  AlertPreference,
} from '@/lib/types';

/** Which of them is being looked at. */
type View = 'live' | 'unread' | 'cleared';

const PAGE_SIZE = 30;

/**
 * The Alerts screen (SRS §8.11, FR-COM-05) — everything raised for this person,
 * at length, where the bell shows only the top of it.
 *
 * A LIST, not a feed of cards: unlike a broadcast, an alert is one sentence, and
 * what a reader does here is scan a lot of them for the two that matter. Grouped
 * by day, because "when" is how anybody looks for one they half-remember.
 *
 * The three views are the three states an alert can be in, and they are
 * deliberately not filters over one list:
 *  - **Waiting** is what still stands. The default, and the useful one.
 *  - **Unread** is that, narrowed to what has not been looked at.
 *  - **Cleared** is the archive — resolved by the module that raised it, or put
 *    down by the reader. It answers "what was I told last Tuesday", which a bell
 *    that only ever shows live alerts cannot.
 *
 * It is NOT filtered by active company. An alert follows the person: hiding one
 * because they happen to be working in another company today is exactly how
 * somebody misses the thing they were told about. Where an alert came from
 * somewhere else, the row says so.
 */
export function AlertsScreen() {
  const router = useRouter();
  const toast = useToast();
  const { companies, activeCompanyId } = useAuth();
  const alerts = useAlerts();

  const [view, setView] = useState<View>('live');
  const [category, setCategory] = useState<AlertCategory | 'ALL'>('ALL');
  const [items, setItems] = useState<Alert[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  /**
   * The toast helpers, reachable from `load` without being a dependency of it —
   * the context value is unmemoized, so depending on it turns one failed load
   * into a request loop.
   */
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const load = useCallback(
    async (opts: { page: number; append: boolean }) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(opts.page),
          pageSize: String(PAGE_SIZE),
        });
        if (view === 'cleared') params.set('cleared', '1');
        if (view === 'unread') params.set('unread', '1');
        if (category !== 'ALL') params.set('category', category);

        const res = await api.get<AlertPage>(`/notifications?${params}`);
        setItems((prev) => (opts.append ? [...prev, ...res.items] : res.items));
        setTotal(res.total);
        setHasMore(res.hasMore);
        setPage(res.page);
      } catch {
        toastRef.current.error('Could not load your alerts.');
      } finally {
        setLoading(false);
      }
    },
    [view, category],
  );

  useEffect(() => {
    void load({ page: 1, append: false });
  }, [load]);

  // Anything arriving or being taken back while the screen is open. The version
  // counter is bumped by the provider's stream, so this stays in step with the
  // bell without opening a second stream of its own.
  const version = alerts?.version ?? 0;
  useEffect(() => {
    if (!version) return;
    void load({ page: 1, append: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const open = (alert: Alert) => {
    if (!alert.readAt) void markRead(alert);
    if (!alert.route) return;
    router.push(
      alert.documentId
        ? `${alert.route}?${DOC_PARAM}=${alert.documentId}`
        : alert.route,
    );
  };

  const markRead = async (alert: Alert) => {
    setItems((list) =>
      list.map((a) =>
        a.id === alert.id ? { ...a, readAt: new Date().toISOString() } : a,
      ),
    );
    // Through the provider, so the badge and the bell agree with this screen.
    await alerts?.markRead(alert.id);
  };

  const dismiss = async (alert: Alert) => {
    setItems((list) => list.filter((a) => a.id !== alert.id));
    setTotal((n) => Math.max(0, n - 1));
    await alerts?.dismiss(alert.id);
  };

  const markAllRead = async () => {
    setItems((list) =>
      list.map((a) =>
        a.readAt ? a : { ...a, readAt: new Date().toISOString() },
      ),
    );
    await alerts?.markAllRead();
    if (view === 'unread') void load({ page: 1, append: false });
  };

  const dismissAll = async () => {
    try {
      await api.post('/notifications/dismiss-all');
      await alerts?.refresh();
      void load({ page: 1, append: false });
    } catch {
      toastRef.current.error('Could not clear your alerts.');
    }
  };

  const companyName = (id?: number | null) =>
    companies.find((c) => c.id === id)?.name ?? null;

  // Day headings, computed in render rather than stored: the list is short and
  // re-grouping it is cheaper than keeping a second structure in step with it.
  let lastDay = '';

  return (
    <div className="flex h-full flex-col gap-3">
      {/* ---- what is being looked at ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          tabs={[
            { key: 'live', label: 'Waiting' },
            { key: 'unread', label: 'Unread' },
            { key: 'cleared', label: 'Cleared' },
          ]}
          active={view}
          onChange={(k) => setView(k as View)}
        />

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as AlertCategory | 'ALL')}
          className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <option value="ALL">All kinds</option>
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {categoryMeta(c).label}
            </option>
          ))}
        </select>

        <span className="text-xs text-slate-400">
          {total} {total === 1 ? 'alert' : 'alerts'}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {view !== 'cleared' && (
            <>
              <button
                onClick={() => void markAllRead()}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <CheckCheck className="h-4 w-4" />
                Mark all read
              </button>
              <button
                onClick={() => void dismissAll()}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Archive className="h-4 w-4" />
                Clear all
              </button>
            </>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            title="Choose what you are told about"
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Settings2 className="h-4 w-4" />
            Settings
          </button>
        </div>
      </div>

      {/* ---- the list ---- */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {loading && items.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-400">Loading…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-center">
            <BellOff className="h-8 w-8 text-slate-300" />
            <p className="text-sm text-slate-400">
              {view === 'cleared'
                ? 'Nothing has been cleared yet.'
                : view === 'unread'
                  ? 'Nothing unread.'
                  : 'Nothing waiting for you.'}
            </p>
          </div>
        ) : (
          <>
            {items.map((a) => {
              const meta = categoryMeta(a.category);
              const day = dayLabel(a.createdAt);
              const heading = day !== lastDay ? day : null;
              lastDay = day;
              const elsewhere =
                a.companyId && a.companyId !== activeCompanyId
                  ? companyName(a.companyId)
                  : null;

              return (
                <div key={a.id}>
                  {heading && (
                    <p className="sticky top-0 z-10 bg-slate-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:bg-slate-950/60">
                      {heading}
                    </p>
                  )}
                  <div
                    className={cn(
                      'group flex items-start gap-3 border-b border-slate-100 px-4 py-3 transition last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50',
                      PRIORITY_ROW[a.priority],
                      !a.readAt && 'bg-brand-50/40 dark:bg-brand-950/30',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-lg',
                        meta.tint,
                      )}
                    >
                      <meta.Icon className="h-[18px] w-[18px]" />
                    </span>

                    <button
                      onClick={() => open(a)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            'text-sm',
                            a.readAt
                              ? 'text-slate-700 dark:text-slate-300'
                              : 'font-semibold text-slate-900 dark:text-slate-100',
                          )}
                        >
                          {a.title}
                        </span>
                        {a.priority !== 'NORMAL' && (
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                              PRIORITY_TAG[a.priority],
                            )}
                          >
                            {a.priority === 'URGENT' ? 'Urgent' : 'Important'}
                          </span>
                        )}
                        {/* Where it happened, when that is not where the reader
                            is working. Silent otherwise: labelling every row
                            with the company they are already in is noise. */}
                        {elsewhere && (
                          <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            <Building2 className="h-3 w-3" />
                            {elsewhere}
                          </span>
                        )}
                        {a.resolvedAt && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            No longer waiting
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-sm text-slate-600 dark:text-slate-400">
                        {a.body}
                      </span>
                      <span className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                        {fullTime(a.createdAt)}
                        {a.route && (
                          <span className="flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" />
                            Open
                          </span>
                        )}
                      </span>
                    </button>

                    {view !== 'cleared' && (
                      <div className="flex flex-none items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                        {!a.readAt && (
                          <button
                            onClick={() => void markRead(a)}
                            title="Mark read"
                            aria-label="Mark read"
                            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => void dismiss(a)}
                          title="Clear"
                          aria-label="Clear"
                          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {hasMore && (
              <button
                onClick={() => void load({ page: page + 1, append: true })}
                disabled={loading}
                className="w-full py-3 text-center text-sm font-medium text-brand-600 hover:bg-slate-50 disabled:opacity-50 dark:text-brand-400 dark:hover:bg-slate-800"
              >
                {loading ? 'Loading…' : 'Show older'}
              </button>
            )}
          </>
        )}
      </div>

      {settingsOpen && <AlertSettings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

/**
 * What this person wants to be told about.
 *
 * Switching a kind off means it is never raised for them — not written and
 * hidden. Said plainly in the panel, because "mute" is otherwise read as "keep
 * it, quietly", and somebody would go looking for what they had switched off.
 *
 * The push column is stored and shown as coming, not offered: browser push
 * (FR-COM-06) has no transport behind it yet, and a switch that does nothing is
 * worse than one that is not there.
 */
function AlertSettings({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [prefs, setPrefs] = useState<AlertPreference[]>([]);
  const [loading, setLoading] = useState(true);

  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    let alive = true;
    api
      .get<AlertPreference[]>('/notifications/preferences')
      .then((rows) => alive && setPrefs(rows))
      .catch(() => toastRef.current.error('Could not load your settings.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const toggle = async (pref: AlertPreference) => {
    const next = !pref.inApp;
    setPrefs((list) =>
      list.map((p) =>
        p.category === pref.category ? { ...p, inApp: next } : p,
      ),
    );
    try {
      await api.put('/notifications/preferences', {
        category: pref.category,
        inApp: next,
      });
    } catch {
      setPrefs((list) =>
        list.map((p) =>
          p.category === pref.category ? { ...p, inApp: !next } : p,
        ),
      );
      toastRef.current.error('Could not save that.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              What you are told about
            </p>
            <p className="text-xs text-slate-400">
              Switched off means it is never raised for you.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {loading ? (
            <p className="p-6 text-center text-sm text-slate-400">Loading…</p>
          ) : (
            prefs.map((p) => {
              const meta = categoryMeta(p.category);
              return (
                <label
                  key={p.category}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <span
                    className={cn(
                      'flex h-8 w-8 flex-none items-center justify-center rounded-lg',
                      meta.tint,
                    )}
                  >
                    <meta.Icon className="h-4 w-4" />
                  </span>
                  <span className="flex-1 text-sm text-slate-700 dark:text-slate-200">
                    {meta.label}
                  </span>
                  <input
                    type="checkbox"
                    checked={p.inApp}
                    onChange={() => void toggle(p)}
                    className="h-4 w-4 accent-brand-600"
                  />
                </label>
              );
            })
          )}
        </div>

        <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-400 dark:border-slate-800">
          Browser push is coming — these choices will apply to it too.
        </p>
      </div>
    </div>
  );
}
