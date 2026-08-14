'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BellOff,
  Building2,
  Check,
  ExternalLink,
  MailOpen,
  Undo2,
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
import type { Alert, AlertCategory, AlertPage } from '@/lib/types';

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
  /** Ticked rows, by id. Cleared whenever the list underneath them changes. */
  const [selected, setSelected] = useState<Set<number>>(new Set());
  /**
   * The kinds THIS person receives, which is what the filter offers. An admin
   * decides them on Users & Data Security; offering a kind that was switched
   * off would be a choice that can never match anything.
   */
  const [kinds, setKinds] = useState<AlertCategory[]>([]);

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
    // A tick means "this row", so it cannot survive the rows changing under it.
    setSelected(new Set());
  }, [load]);

  // What this person is set to receive. Fetched once — an admin changing it is
  // not something that happens while somebody is reading their alerts.
  useEffect(() => {
    let alive = true;
    api
      .get<AlertCategory[]>('/notifications/categories')
      .then((rows) => alive && setKinds(rows))
      .catch(() => {
        // Fall back to the full list rather than an empty filter: a reader who
        // cannot narrow their alerts is worse off than one offered a kind they
        // happen to have none of.
        if (alive) setKinds(CATEGORY_ORDER);
      });
    return () => {
      alive = false;
    };
  }, []);

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

  // ------------------------------------------------------------ selection --

  const toggleOne = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Every row currently loaded — not every row that matches, which the reader
   *  cannot see and so cannot mean. */
  const allOnPage = items.length > 0 && items.every((a) => selected.has(a.id));
  const toggleAll = () =>
    setSelected(allOnPage ? new Set() : new Set(items.map((a) => a.id)));

  const clearSelection = () => setSelected(new Set());

  /**
   * One action over everything ticked, in one request.
   *
   * Not optimistic: a bulk restore can partly fail — some of what was ticked may
   * be over — and the honest thing is to say what actually happened rather than
   * to paint the whole list as done and quietly put half of it back.
   */
  const runBulk = async (
    action: 'read' | 'unread' | 'dismiss' | 'restore',
    label: string,
  ) => {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      const res = await api.post<{ count: number; skipped: number }>(
        '/notifications/bulk',
        { ids, action },
      );
      clearSelection();
      await alerts?.refresh();
      void load({ page: 1, append: false });

      if (res.skipped && !res.count) {
        // Nothing moved. Said as a failure, not as a cheerful "0 done" —
        // because to the reader nothing happened.
        toastRef.current.error(
          `None could be moved back: what they were about has already been dealt with.`,
        );
      } else if (res.skipped) {
        toastRef.current.success(
          `${res.count} ${label}. ${res.skipped} could not be — already dealt with.`,
        );
      } else {
        toastRef.current.success(`${res.count} ${label}.`);
      }
    } catch {
      toastRef.current.error('That could not be applied to all of them.');
    }
  };

  /**
   * How many of the ticked rows could actually go back to waiting — the ones the
   * READER cleared. An alert the module resolved is over, and offering a live
   * button that will refuse it is how somebody ends up thinking the screen is
   * broken.
   */
  const restorable = items.filter(
    (a) => selected.has(a.id) && a.dismissedAt && !a.resolvedAt,
  ).length;

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
          {kinds.map((c) => (
            <option key={c} value={c}>
              {categoryMeta(c).label}
            </option>
          ))}
        </select>

        <span className="text-xs text-slate-400">
          {total} {total === 1 ? 'alert' : 'alerts'}
        </span>

        {/*
          Nothing else in this toolbar, deliberately.

          There is ONE way to act on an alert: tick it, then use the bar that
          appears. "Mark all read" and "Clear all" sat here acting on everything
          that matched the filter — including rows below the fold that nobody
          had looked at — which is a different and much larger promise than the
          same words next to a tick box, and the two side by side invited the
          wrong one to be pressed.

          Nor is there a settings button. Which alerts a person receives is set
          by an admin on Users & Data Security: whether the counter staff hear
          about stock-outs is the organisation's decision, and a switch here
          would let anybody opt out of being told without anybody knowing until
          something was missed.
        */}
      </div>

      {/*
        ---- what is ticked ----
        Appears only when something is. The actions here read "these ones",
        against the toolbar's "all of them" above — two different scopes, so
        they are never offered in the same place at the same time.
      */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 dark:border-brand-800 dark:bg-brand-950/40">
          <span className="mr-1 text-sm font-medium text-brand-800 dark:text-brand-200">
            {selected.size} selected
          </span>

          <button
            onClick={() => void runBulk('read', 'marked read')}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-white dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Check className="h-4 w-4" />
            Mark read
          </button>
          <button
            onClick={() => void runBulk('unread', 'marked unread')}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-white dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <MailOpen className="h-4 w-4" />
            Mark unread
          </button>

          {/* Clearing and restoring are opposites, so only the one that applies
              to what is being looked at is offered. */}
          {view === 'cleared' ? (
            <button
              onClick={() => void runBulk('restore', 'moved back to waiting')}
              disabled={!restorable}
              title={
                restorable
                  ? undefined
                  : 'None of these can go back: what they were about has already been dealt with.'
              }
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Undo2 className="h-4 w-4" />
              Move back to waiting
              {/* Says how many of the ticked rows it will actually move, when
                  that is not all of them — so a partial result is expected
                  rather than discovered afterwards. */}
              {restorable > 0 && restorable < selected.size && (
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                  ({restorable} of {selected.size})
                </span>
              )}
            </button>
          ) : (
            <button
              onClick={() => void runBulk('dismiss', 'cleared')}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-white dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <X className="h-4 w-4" />
              Clear
            </button>
          )}

          <button
            onClick={clearSelection}
            className="ml-auto rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-white dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
        </div>
      )}

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
            {/* Selects what is LOADED, which is what the reader can see and so
                the only thing they can be taken to mean. "Show older" first if
                they want more than a page of it. */}
            <label className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <input
                type="checkbox"
                checked={allOnPage}
                onChange={toggleAll}
                className="h-4 w-4 accent-brand-600"
              />
              {allOnPage
                ? 'All shown selected'
                : `Select all ${items.length} shown`}
            </label>

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
                      selected.has(a.id) && 'bg-brand-50 dark:bg-brand-950/50',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => toggleOne(a.id)}
                      aria-label={`Select "${a.title}"`}
                      className="mt-3 h-4 w-4 flex-none accent-brand-600"
                    />

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
                        {/*
                          WHY it is off the waiting list, which the reader
                          otherwise has no way to tell — and the two reasons
                          behave differently. One they did themselves and can
                          undo; the other happened to them and cannot be undone,
                          because what it was about is over.
                        */}
                        {a.resolvedAt ? (
                          <span
                            title="What this was about has been dealt with — the document was approved, or the task finished or deleted. It cannot go back to waiting."
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                          >
                            No longer waiting
                          </span>
                        ) : (
                          a.dismissedAt && (
                            <span
                              title="You cleared this yourself. It can be moved back to waiting."
                              className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                            >
                              Cleared by you
                            </span>
                          )
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
    </div>
  );
}
