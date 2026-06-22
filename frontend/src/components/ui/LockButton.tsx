'use client';

import { Lock, Unlock } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Lock/unlock toggle for cpanel master records. Only super admins can toggle;
 * everyone else sees a static lock indicator when the record is locked.
 */
export function LockButton({
  locked,
  canToggle,
  onToggle,
}: {
  locked?: boolean;
  canToggle: boolean;
  onToggle: () => void;
}) {
  if (!canToggle) {
    return locked ? (
      <span
        className="rounded-lg p-1.5 text-amber-500"
        title="Locked — only a super admin can unlock"
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
