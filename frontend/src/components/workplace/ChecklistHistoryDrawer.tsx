'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/providers/ToastProvider';
import { CloseFooter, Drawer } from '@/components/ui/Drawer';
import { cn, formatDayMonthYear } from '@/lib/utils';
import type {
  ChecklistDayStatus,
  ChecklistHistory,
  ChecklistTemplate,
} from '@/lib/types';

/** How each day's outcome is worded and painted. */
const DAY_STATUS: Record<ChecklistDayStatus, { label: string; tone: string }> =
  {
    COMPLETED: {
      label: 'Completed',
      tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
    },
    OPEN: {
      label: 'In hand',
      tone: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
    },
    OVERDUE: {
      label: 'Overdue',
      tone: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
    },
    /**
     * The row that matters most, and the one a task board cannot show: a day
     * nobody did leaves no task behind, so it exists only as a gap in the
     * calendar.
     */
    MISSED: {
      label: 'Missed',
      tone: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
    },
    CANCELLED: {
      label: 'Called off',
      tone: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
    },
    /**
     * Today, with nothing raised against it yet. Never counted for or against
     * the record: the day is not over.
     */
    SCHEDULED: {
      label: 'Not out yet',
      tone: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
    },
  };

/** How long a window the register offers. */
const WINDOWS = [30, 90, 180];

/** "Fri 14/08/2026" — a register is read by date, so the weekday earns its place. */
const dayLabelOf = (date: string) => {
  const weekday = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
  });
  return `${weekday} ${formatDayMonthYear(date)}`;
};

/**
 * The register for one recurring checklist: one row per day it was expected,
 * and what became of it.
 *
 * This is the view an auditor asks for, and it deliberately cannot be read off
 * the task board — a board shows what EXISTS, and the most important line in a
 * hygiene record is the day nothing exists for.
 *
 * It does NOT repeat the signatures. Each row links to its occurrence, where the
 * task drawer already shows which line was ticked, by whom and when; copying
 * that here would be a second place for the same record to be read, and one of
 * the two would eventually be wrong.
 */
export function ChecklistHistoryDrawer({
  template,
  onClose,
  onOpenTask,
}: {
  /** The checklist being read, or null when the drawer is shut. */
  template: ChecklistTemplate | null;
  onClose: () => void;
  onOpenTask: (taskId: number, isForMe: boolean) => void;
}) {
  const toast = useToast();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<ChecklistHistory | null>(null);
  const [loading, setLoading] = useState(false);

  // See MailboxScreen: the toast context value is unmemoized, so depending on it
  // would turn one failed load into a request loop.
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const templateId = template?.id ?? null;
  useEffect(() => {
    if (!templateId) {
      setData(null);
      return;
    }
    let alive = true;
    setLoading(true);
    api
      .get<ChecklistHistory>(`/checklists/${templateId}/history?days=${days}`)
      .then((res) => {
        if (alive) setData(res);
      })
      .catch(() => toastRef.current.error('Could not load the history.'))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [templateId, days]);

  const s = data?.summary;
  const tiles = s
    ? [
        {
          label: 'Kept',
          value: `${s.rate}%`,
          hint: `${s.completed} of ${s.expected} days`,
          tone:
            s.rate >= 90
              ? 'text-emerald-600 dark:text-emerald-400'
              : s.rate >= 70
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-rose-600 dark:text-rose-400',
        },
        {
          label: 'On time',
          value: String(s.onTime),
          hint: s.late ? `${s.late} late` : 'none late',
          tone: 'text-slate-800 dark:text-slate-100',
        },
        {
          label: 'Missed',
          value: String(s.missed),
          hint: 'nobody signed',
          tone: s.missed
            ? 'text-rose-600 dark:text-rose-400'
            : 'text-slate-400',
        },
        {
          label: 'Outstanding',
          value: String(s.outstanding),
          hint: 'still open',
          tone: s.outstanding
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-slate-400',
        },
      ]
    : [];

  return (
    <Drawer
      open={!!template}
      onClose={onClose}
      title={template ? `${template.name} — history` : 'History'}
      subtitle={
        data ? `${dayLabelOf(data.from)} to ${dayLabelOf(data.to)}` : undefined
      }
      width="lg"
      footer={<CloseFooter onClose={onClose} />}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {WINDOWS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium transition',
                days === d
                  ? 'border-brand-300 bg-brand-600 text-white dark:border-brand-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              {d} days
            </button>
          ))}
        </div>

        {tiles.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tiles.map((tile) => (
              <div
                key={tile.label}
                className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"
              >
                <p className={cn('text-xl font-bold', tile.tone)}>
                  {tile.value}
                </p>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {tile.label}
                </p>
                <p className="text-[11px] text-slate-400">{tile.hint}</p>
              </div>
            ))}
          </div>
        )}

        {loading && !data ? (
          <p className="p-6 text-center text-sm text-slate-400">Loading…</p>
        ) : !data || data.rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-400">
            Nothing yet — it has not been expected on any day in this window.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
            {data.rows.map((row) => {
              const meta = DAY_STATUS[row.status];
              return (
                <div
                  key={row.date}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 px-3 py-2 last:border-b-0 dark:border-slate-800"
                >
                  <span className="w-28 flex-none text-xs font-medium text-slate-700 dark:text-slate-200">
                    {dayLabelOf(row.date)}
                  </span>
                  <span
                    className={cn(
                      'w-24 flex-none rounded-full px-2 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide',
                      meta.tone,
                    )}
                  >
                    {meta.label}
                  </span>
                  <span className="w-14 flex-none text-xs text-slate-500 dark:text-slate-400">
                    {row.total ? `${row.done}/${row.total}` : '—'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-500 dark:text-slate-400">
                    {row.completedByName
                      ? `${row.completedByName}${row.late ? ' · late' : ''}`
                      : row.status === 'MISSED'
                        ? 'Nobody signed for it'
                        : ''}
                  </span>
                  {row.taskId !== null && (
                    <button
                      onClick={() =>
                        onOpenTask(row.taskId as number, !!template?.isForMe)
                      }
                      title="Open it — the task shows who ticked each line"
                      aria-label="Open the occurrence"
                      className="flex-none rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Drawer>
  );
}
