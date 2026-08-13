'use client';

import { useEffect, useRef, useState } from 'react';
import { Lock, Unlock, ChevronDown } from 'lucide-react';

/**
 * Toolbar control offering "Lock all" / "Unlock all" for a listing. The parent
 * (via useLock) owns the actual work and privileges; this just presents the two
 * actions. An option is shown only when the matching privilege is present, so a
 * user who can lock but not unlock sees just "Lock all".
 */
export function BulkLockMenu({
  canLock,
  canUnlock,
  onLockAll,
  onUnlockAll,
}: {
  canLock?: boolean;
  canUnlock?: boolean;
  onLockAll: () => void;
  onUnlockAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!canLock && !canUnlock) return null;

  const pick = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Lock or unlock all"
        className="btn-secondary flex-none px-2.5"
      >
        <Lock className="h-4 w-4" />
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
          {canLock && (
            <button
              type="button"
              onClick={() => pick(onLockAll)}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Lock className="h-4 w-4 flex-none text-amber-600" />
              <span className="flex-1 text-left">Lock all</span>
            </button>
          )}
          {canUnlock && (
            <button
              type="button"
              onClick={() => pick(onUnlockAll)}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Unlock className="h-4 w-4 flex-none text-slate-500" />
              <span className="flex-1 text-left">Unlock all</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
