'use client';

import { ToggleLeft, ToggleRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Inline Active/Inactive toggle for listing rows. Lets a record be retired
 * (set inactive) without deleting it — so its auto-generated code is preserved
 * and never leaves a confusing gap. Rendered to the left of View/Edit/Delete.
 */
export function StatusToggle({
  active,
  canEdit = true,
  onToggle,
}: {
  active: boolean;
  canEdit?: boolean;
  onToggle: () => void;
}) {
  if (!canEdit) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      title={active ? 'Set inactive' : 'Set active'}
      aria-label={active ? 'Set inactive' : 'Set active'}
      className={cn(
        'rounded-lg p-1.5 transition',
        active
          ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950'
          : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800',
      )}
    >
      {active ? (
        <ToggleRight className="h-4 w-4" />
      ) : (
        <ToggleLeft className="h-4 w-4" />
      )}
    </button>
  );
}
