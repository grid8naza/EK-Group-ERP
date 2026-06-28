'use client';

import { Lock, Unlock } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Lock/unlock toggle for cpanel master records. The action depends on the row's
 * state: locking an unlocked record needs the `lock` privilege, unlocking a
 * locked one needs `unlock`. Users without the relevant privilege see a static
 * lock indicator when the record is locked (so they know it's locked) and
 * nothing when it's unlocked.
 */
export function LockButton({
  locked,
  canLock,
  canUnlock,
  onToggle,
}: {
  locked?: boolean;
  canLock: boolean;
  canUnlock: boolean;
  onToggle: () => void;
}) {
  const canToggle = locked ? canUnlock : canLock;
  if (!canToggle) {
    return locked ? (
      <span
        className="rounded-lg p-1.5 text-amber-500"
        title="Locked — you don't have permission to unlock"
      >
        <Lock className="h-4 w-4" />
      </span>
    ) : null;
  }
  return (
    <button
      onClick={onToggle}
      className={cn(
        'rounded-lg p-1.5 transition',
        locked
          ? 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950'
          : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800',
      )}
      title={locked ? 'Unlock to allow edit/delete' : 'Lock'}
    >
      {locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
    </button>
  );
}
