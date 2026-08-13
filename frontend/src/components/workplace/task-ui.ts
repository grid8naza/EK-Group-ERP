import type { TaskStatus } from '@/lib/types';

/**
 * What the board, the drawer and the composer all have to agree about.
 *
 * In their own module rather than exported from the board: the drawer needs the
 * columns and the board needs the drawer, and importing each other leaves one
 * of them reading the other's constants before they exist — a
 * "Cannot access 'COLUMNS' before initialization" at first render, not at build.
 */

/** Which side of the work a screen shows. */
export type TaskSide = 'to-me' | 'by-me';

/** The board's columns, left to right — the order work moves in. */
export const COLUMNS: { status: TaskStatus; label: string; tone: string }[] = [
  { status: 'TODO', label: 'To do', tone: 'bg-slate-400' },
  { status: 'IN_PROGRESS', label: 'In progress', tone: 'bg-brand-500' },
  { status: 'BLOCKED', label: 'Blocked', tone: 'bg-amber-500' },
  { status: 'DONE', label: 'Done', tone: 'bg-emerald-500' },
];

export const PRIORITY_TONE: Record<string, string> = {
  URGENT: 'text-rose-700 bg-rose-50 dark:bg-rose-950/50 dark:text-rose-300',
  HIGH: 'text-amber-700 bg-amber-50 dark:bg-amber-950/50 dark:text-amber-300',
  NORMAL: 'text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-300',
  LOW: 'text-slate-500 bg-slate-50 dark:bg-slate-800/60 dark:text-slate-400',
};

/** Due dates read as words near today, and as a date once they are not. */
export function dueLabel(iso: string | null): string {
  if (!iso) return '';
  const due = new Date(iso);
  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(due) - startOf(new Date())) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days < 0) return `${Math.abs(days)}d late`;
  if (days <= 6) return `in ${days}d`;
  return due.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}
