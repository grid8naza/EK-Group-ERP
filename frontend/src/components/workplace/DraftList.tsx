'use client';

import { FileEdit, Trash2 } from 'lucide-react';
import { useConfirm } from '@/providers/ConfirmProvider';
import { listTime } from '@/components/workplace/people';
import { cn } from '@/lib/utils';

/** One unsent thing, whatever kind it is. */
export interface DraftRow {
  id: number;
  /** The subject or title. Blank is normal — a draft may be barely started. */
  title: string;
  /** Who it is for, or what it says: one line under the title. */
  subline: string;
  updatedAt: string;
}

/**
 * Somebody's unsent mail, circulars or announcements.
 *
 * One component for all three, because a draft list is the same list whatever
 * it holds: what you called it, who it was going to, when you last touched it,
 * and the two things you can do with it — carry on writing, or throw it away.
 * The differences between a mail and a circular are all in the composer that
 * opens, not in the list of things not yet sent.
 */
export function DraftList({
  drafts,
  loading,
  emptyMessage,
  onOpen,
  onDelete,
}: {
  drafts: DraftRow[];
  loading?: boolean;
  emptyMessage: string;
  onOpen: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const confirm = useConfirm();

  const remove = async (row: DraftRow) => {
    const ok = await confirm({
      title: 'Delete this draft?',
      message: `“${
        row.title || 'Untitled'
      }” has not been sent to anybody, so nothing is withdrawn — the draft itself is gone for good.`,
      confirmText: 'Delete',
      cancelText: 'Keep it',
    });
    if (ok) onDelete(row.id);
  };

  if (!loading && drafts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
        <FileEdit className="h-10 w-10" />
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
      {drafts.map((row) => (
        <div
          key={row.id}
          className="flex items-start gap-3 px-3 py-2.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
        >
          <FileEdit className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
          <button
            type="button"
            onClick={() => onOpen(row.id)}
            className="min-w-0 flex-1 text-left"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span
                className={cn(
                  'truncate text-sm font-medium',
                  row.title
                    ? 'text-slate-800 dark:text-slate-100'
                    : 'italic text-slate-400',
                )}
              >
                {row.title || 'Untitled'}
              </span>
              <span className="shrink-0 text-[11px] text-slate-400">
                {listTime(row.updatedAt)}
              </span>
            </div>
            <div className="truncate text-xs text-slate-400">
              {row.subline || 'Nothing written yet'}
            </div>
          </button>
          <button
            type="button"
            onClick={() => void remove(row)}
            title="Delete this draft"
            className="shrink-0 rounded p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
