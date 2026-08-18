'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  GitBranch,
  LayoutDashboard,
  Mail,
  RefreshCw,
} from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DOC_PARAM } from '@/lib/hooks';
import { resolveIcon } from '@/lib/icons';
import { useAuth } from '@/providers/AuthProvider';
import { useAlerts } from '@/providers/AlertProvider';
import { useToast } from '@/providers/ToastProvider';
import { categoryMeta } from '@/components/workplace/alert-ui';
import { dayLabel, listTime } from '@/components/workplace/people';
import { cn, formatDayMonthYear } from '@/lib/utils';
import type {
  WorkplaceDashboard,
  WorkplaceItem,
  WorkplaceItemKind,
  WorkplaceTile,
} from '@/lib/types';

/** How a tile's tone paints its number. Quiet by default; loud only when late. */
const TONE_TILE: Record<string, string> = {
  normal: 'border-slate-200 dark:border-slate-800',
  attention: 'border-slate-200 dark:border-slate-800',
  urgent: 'border-rose-300 dark:border-rose-900',
};
const TONE_NUMBER: Record<string, string> = {
  normal: 'text-slate-400 dark:text-slate-500',
  attention: 'text-slate-900 dark:text-white',
  urgent: 'text-rose-600 dark:text-rose-400',
};
const TONE_ICON: Record<string, string> = {
  normal: 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500',
  attention: 'bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-400',
  urgent: 'bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400',
};

/** What each row of the waiting list is, and how it is dressed. */
const KIND: Record<
  WorkplaceItemKind,
  { label: string; icon: typeof CheckCircle2; tint: string }
> = {
  APPROVAL: {
    label: 'Approval',
    icon: CheckCircle2,
    tint: 'bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300',
  },
  REVIEW: {
    label: 'Review',
    icon: Eye,
    tint: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  },
  TASK: {
    label: 'Task',
    icon: ClipboardCheck,
    tint: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  },
  CIRCULAR: {
    label: 'Circular',
    icon: categoryMeta('MESSAGE').Icon,
    tint: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  },
  MAIL: {
    label: 'Mail',
    icon: Mail,
    tint: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  },
  ALERT: {
    label: 'Alert',
    icon: categoryMeta('SYSTEM').Icon,
    tint: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  },
};

/** Morning, afternoon, evening — the page opens by saying when it is. */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** "Due today", "3 days late", "Due 22 Aug" — how long there is. */
function dueLabel(item: WorkplaceItem): string | null {
  if (!item.dueAt) return null;
  const due = new Date(item.dueAt);
  const midnight = new Date().setHours(0, 0, 0, 0);
  const days = Math.round(
    (new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime() -
      midnight) /
      86_400_000,
  );
  if (days < 0) return `${Math.abs(days)} ${days === -1 ? 'day' : 'days'} late`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due ${formatDayMonthYear(due)}`;
}

/**
 * The Workplace dashboard — one page saying what is waiting for THIS PERSON,
 * across every company and branch they have privileges for.
 *
 * That scope is the whole point, and it is what makes this different from every
 * other dashboard in the application. The rest belong to a company: pick a
 * company in the topbar and the numbers are that company's. This one belongs to
 * whoever is signed in. A director who approves for three companies has one
 * morning, not three, and the payment waiting at Regency does not stop being
 * theirs because they are working in Bake House today.
 *
 * Which is why the company appears as a TAG on the things themselves, and as a
 * panel that breaks the numbers down, rather than as a filter over the page. The
 * reader is not asked to go looking company by company for what they might have
 * missed — that is precisely the failure this page exists to prevent.
 */
export function DashboardScreen() {
  const router = useRouter();
  const toast = useToast();
  const { user, activeCompanyId, switchCompany } = useAuth();
  const alerts = useAlerts();

  const [data, setData] = useState<WorkplaceDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  // See MailboxScreen: the toast context value is unmemoized, so depending on
  // it would turn one failed load into a request loop.
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<WorkplaceDashboard>('/workplace/dashboard'));
    } catch {
      toastRef.current.error('Could not load your dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Anything the alert stream reports is a thing that just changed on this page
  // too — an approval raised, a task assigned. Cheaper and simpler than a second
  // stream of the dashboard's own.
  const version = alerts?.version ?? 0;
  useEffect(() => {
    if (!version) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const companyName = (id?: number | null) =>
    data?.companies.find((c) => c.id === id)?.name ?? null;
  const branchName = (id?: number | null) =>
    data?.branches.find((b) => b.id === id)?.name ?? null;

  /**
   * Open what a row is about — switching company FIRST where it belongs to
   * another one, because most screens read the active company and would
   * otherwise open, correctly and uselessly, on somebody else's data.
   */
  const open = async (item: WorkplaceItem) => {
    if (!item.route) return;
    if (item.companyId && item.companyId !== activeCompanyId) {
      await switchCompany(item.companyId);
    }
    router.push(
      item.documentId
        ? `${item.route}?${DOC_PARAM}=${item.documentId}`
        : item.route,
    );
  };

  const tiles = data?.tiles ?? [];
  const waiting = data?.waiting ?? [];

  // Only companies with something in them earn a row: a table of five companies
  // and thirty zeroes says less than a table of the two that need attention.
  const companyRows = (data?.companies ?? [])
    .map((c) => ({
      ...c,
      counts: tiles
        .map((t) => ({
          tile: t,
          count: t.byCompany?.find((b) => b.companyId === c.id)?.count ?? 0,
        }))
        .filter((x) => x.count > 0),
    }))
    .filter((c) => c.counts.length > 0);

  return (
    <>
      {/*
        The page's own header, rendered HERE rather than by the route shell,
        because the greeting belongs in its right-hand slot and is built from
        state this component holds — who is signed in, and how many companies
        the answer covers. It sits OUTSIDE the flex column below, so its own
        `mb-6` is the only gap under it — the same distance every other page
        puts between its header and its content.
      */}
      <PageHeader
        title="My Day"
        description="Everything waiting for you, across the group"
        icon={<LayoutDashboard className="h-5 w-5" />}
        size="sm"
        actions={
          <>
            <div className="text-right">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                {greeting()}
                {user?.name ? `, ${user.name.split(' ')[0]}` : ''}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {/* The weekday is worth having on a greeting line; the date
                    itself is written the way every other date here is. */}
                {new Date().toLocaleDateString(undefined, { weekday: 'long' })},{' '}
                {formatDayMonthYear(new Date())}
                {data
                  ? ` · across ${data.companies.length} ${data.companies.length === 1 ? 'company' : 'companies'}`
                  : ''}
              </p>
            </div>
            <button
              onClick={() => void load()}
              disabled={loading}
              title="Refresh"
              aria-label="Refresh"
              className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </button>
          </>
        }
      />

      <div className="flex flex-col gap-5">
        {/* ---- the counts ---- */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {loading && !data
            ? Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                />
              ))
            : tiles.map((t) => <Tile key={t.key} tile={t} />)}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* ---- what is waiting ---- */}
          <div className="lg:col-span-2">
            <div className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Waiting on you
                </p>
                <p className="text-[11px] uppercase tracking-wider text-slate-400">
                  Late first
                </p>
              </div>

              {loading && !data ? (
                <p className="p-8 text-center text-sm text-slate-400">
                  Loading…
                </p>
              ) : waiting.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-12 text-center">
                  <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Nothing is waiting on you anywhere.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {waiting.map((item) => {
                    const kind = KIND[item.kind];
                    const due = dueLabel(item);
                    const company = companyName(item.companyId);
                    const branch = branchName(item.branchId);
                    return (
                      <button
                        key={item.key}
                        onClick={() => void open(item)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      >
                        <span
                          className={cn(
                            'mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg',
                            kind.tint,
                          )}
                        >
                          <kind.icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                              {item.title}
                            </span>
                            {due && (
                              <span
                                className={cn(
                                  'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                                  item.overdue
                                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                                    : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
                                )}
                              >
                                {due}
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                            <span>{kind.label}</span>
                            {item.subtitle && (
                              <>
                                <span className="text-slate-300">·</span>
                                <span className="truncate">
                                  {item.subtitle}
                                </span>
                              </>
                            )}
                            {/* Whose it is. Always shown, not only when it is
                              elsewhere: on a page that deliberately mixes
                              companies, "which one" is part of reading the row. */}
                            {company && (
                              <>
                                <span className="text-slate-300">·</span>
                                <span className="flex items-center gap-1">
                                  <Building2 className="h-3 w-3" />
                                  {company}
                                </span>
                              </>
                            )}
                            {branch && (
                              <span className="flex items-center gap-1">
                                <GitBranch className="h-3 w-3" />
                                {branch}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="flex-none text-[11px] text-slate-400">
                          {listTime(item.at)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ---- the same numbers, per company ---- */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Across the group
              </p>
              <p className="text-xs text-slate-400">
                Where your outstanding work is
              </p>
            </div>

            {loading && !data ? (
              <p className="p-8 text-center text-sm text-slate-400">Loading…</p>
            ) : companyRows.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-400">
                Nothing outstanding in any company.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {companyRows.map((c) => (
                  <div key={c.id} className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 flex-none text-slate-400" />
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                        {c.name}
                      </p>
                      {c.id !== activeCompanyId && (
                        <button
                          onClick={() => void switchCompany(c.id)}
                          className="flex-none text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400"
                        >
                          Switch
                        </button>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {c.counts.map(({ tile, count }) => (
                        <span
                          key={tile.key}
                          className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                        >
                          {count} {tile.label.toLowerCase()}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {data && (
              <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-400 dark:border-slate-800">
                As of {dayLabel(data.asOf).toLowerCase()} {listTime(data.asOf)}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/** One count, linking to the screen that holds the whole of it. */
function Tile({ tile }: { tile: WorkplaceTile }) {
  const router = useRouter();
  const Icon = resolveIcon(tile.icon);
  const tone = tile.count === 0 ? 'normal' : (tile.tone ?? 'attention');

  return (
    <button
      onClick={() => router.push(tile.route)}
      className={cn(
        'flex flex-col items-start gap-2 rounded-xl border bg-white p-4 text-left transition hover:border-brand-300 hover:shadow-sm dark:bg-slate-900 dark:hover:border-brand-800',
        TONE_TILE[tone],
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg',
          TONE_ICON[tone],
        )}
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span>
        <span className={cn('block text-2xl font-bold', TONE_NUMBER[tone])}>
          {tile.count}
        </span>
        <span className="block text-xs text-slate-500 dark:text-slate-400">
          {tile.label}
        </span>
      </span>
    </button>
  );
}
