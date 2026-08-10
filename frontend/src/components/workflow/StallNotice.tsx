'use client';

import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A document that has stopped because nobody can act on the level it reached.
 *
 * Worth its own component because the mistake it prevents is the same wherever
 * it happens, and so is the fix. A stalled document looks exactly like one on
 * its way — in progress, no task of yours, waiting — and every screen that
 * cannot tell the two apart lets one sit for a fortnight while everybody
 * assumes somebody else has it.
 *
 * It says what to do rather than only what is wrong, because the reader is
 * usually the person who can do it: the level has no approver who can act for
 * this company, and putting that right is enough. Nothing here needs pressing
 * afterwards — reading the document retries the level.
 */
export function WorkflowStallNotice({
  sequence,
  className,
  children,
}: {
  /** The level it stopped at. */
  sequence: number;
  className?: string;
  /** Anything the screen wants to add — e.g. that it may still be withdrawn. */
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
      <span>
        Stopped at level {sequence}: nobody there can act on it. Give an approver
        access to this company, or put one on that level, and it carries on by
        itself. {children}
      </span>
    </div>
  );
}
