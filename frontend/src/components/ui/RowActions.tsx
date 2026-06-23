'use client';

import { Eye, Pencil, Trash2 } from 'lucide-react';

interface RowActionsProps {
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  canView?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  /** Secondary actions rendered to the LEFT of View (e.g. Modules, Privileges). */
  before?: React.ReactNode;
  /** Lock toggle, rendered LAST (after Delete). */
  lock?: React.ReactNode;
}

const ICON_BTN = 'rounded-lg p-1.5 text-slate-500 transition';
const BRAND = 'hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950';
const ROSE = 'hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950';

/**
 * The standard listing row action cluster, always in the order
 * View, Edit, Delete, Lock (secondary actions via `before`). Renders as a
 * fragment, so the caller supplies the surrounding flex container. Used by
 * DataTable and by the card / master-detail listings so the order is defined
 * once. See memory: listing-action-buttons-order.
 */
export function RowActions({
  onView,
  onEdit,
  onDelete,
  canView = true,
  canEdit = true,
  canDelete = true,
  before,
  lock,
}: RowActionsProps) {
  return (
    <>
      {before}
      {onView && canView && (
        <button onClick={onView} title="View" className={`${ICON_BTN} ${BRAND}`}>
          <Eye className="h-4 w-4" />
        </button>
      )}
      {onEdit && canEdit && (
        <button onClick={onEdit} title="Edit" className={`${ICON_BTN} ${BRAND}`}>
          <Pencil className="h-4 w-4" />
        </button>
      )}
      {onDelete && canDelete && (
        <button onClick={onDelete} title="Delete" className={`${ICON_BTN} ${ROSE}`}>
          <Trash2 className="h-4 w-4" />
        </button>
      )}
      {lock}
    </>
  );
}
