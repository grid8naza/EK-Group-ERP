'use client';

import { api, ApiError } from '@/lib/api';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';

interface Lockable {
  id: number;
  isLocked?: boolean;
}

/**
 * Shared lock/unlock behavior for cpanel master screens. Mirrors the Object
 * Master pattern: only super admins can toggle the lock, and a locked record
 * can't be edited or deleted until unlocked.
 */
export function useLock<T extends Lockable>(opts: {
  /** API base for the entity, e.g. '/companies'. Lock hits `${endpoint}/:id/lock`. */
  endpoint: string;
  /** Singular noun for messages, e.g. 'company'. */
  noun: string;
  /** Display name of a row, used in the lock confirmation. */
  nameOf: (row: T) => string;
  /** Refresh the list after a lock change. */
  reload: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const canToggle = !!user?.isSuperAdmin;

  const toggleLock = async (row: T) => {
    const locking = !row.isLocked;
    if (locking) {
      const ok = await confirm({
        title: `Lock ${opts.noun}`,
        message: `Lock "${opts.nameOf(row)}"? It can't be edited or deleted until unlocked.`,
        confirmText: 'Lock',
      });
      if (!ok) return;
    }
    try {
      await api.patch(`${opts.endpoint}/${row.id}/lock`, { locked: locking });
      toast.success(locking ? `${cap(opts.noun)} locked.` : `${cap(opts.noun)} unlocked.`);
      opts.reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to update lock.');
    }
  };

  const guardEdit = (row: T, fn: () => void) => {
    if (row.isLocked) {
      toast.error(`This ${opts.noun} is locked. Unlock it first to edit.`);
      return;
    }
    fn();
  };

  const guardDelete = (row: T, fn: () => void) => {
    if (row.isLocked) {
      toast.error(`This ${opts.noun} is locked. Unlock it first to delete.`);
      return;
    }
    fn();
  };

  return { canToggle, toggleLock, guardEdit, guardDelete };
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
