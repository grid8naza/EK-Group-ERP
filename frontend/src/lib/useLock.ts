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
 * Master pattern: a locked record can't be edited or deleted until unlocked.
 * Locking requires the screen's `lock` privilege and unlocking the `unlock`
 * privilege (super admins always have both). Pass the screen `route` so the
 * privileges resolve against the right permission entry.
 */
export function useLock<T extends Lockable>(opts: {
  /** API base for the entity, e.g. '/companies'. Lock hits `${endpoint}/:id/lock`. */
  endpoint: string;
  /** Screen route used to resolve lock/unlock privileges, e.g. '/cpanel/companies'. */
  route: string;
  /** Singular noun for messages, e.g. 'company'. */
  noun: string;
  /** Display name of a row, used in the lock confirmation. */
  nameOf: (row: T) => string;
  /** Refresh the list after a lock change. */
  reload: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useAuth();
  const canLock = can(opts.route, 'lock');
  const canUnlock = can(opts.route, 'unlock');
  // Whether the user can perform any lock action (used e.g. to decide if a
  // row's action column is worth showing at all).
  const canToggle = canLock || canUnlock;

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

  // Bulk lock/unlock across a set of rows (the current filtered list). Only the
  // rows that actually need changing are touched, then the list reloads once.
  const lockAll = async (rows: T[]) => {
    const targets = rows.filter((r) => !r.isLocked);
    if (targets.length === 0) {
      toast.info(`No unlocked ${opts.noun}s to lock.`);
      return;
    }
    const ok = await confirm({
      title: `Lock all ${opts.noun}s`,
      message: `Lock ${targets.length} ${opts.noun}${targets.length === 1 ? '' : 's'}? They can't be edited or deleted until unlocked.`,
      confirmText: 'Lock all',
    });
    if (!ok) return;
    await bulkSetLock(targets, true);
  };

  const unlockAll = async (rows: T[]) => {
    const targets = rows.filter((r) => r.isLocked);
    if (targets.length === 0) {
      toast.info(`No locked ${opts.noun}s to unlock.`);
      return;
    }
    const ok = await confirm({
      title: `Unlock all ${opts.noun}s`,
      message: `Unlock ${targets.length} ${opts.noun}${targets.length === 1 ? '' : 's'}?`,
      confirmText: 'Unlock all',
    });
    if (!ok) return;
    await bulkSetLock(targets, false);
  };

  const bulkSetLock = async (targets: T[], locked: boolean) => {
    const results = await Promise.allSettled(
      targets.map((row) =>
        api.patch(`${opts.endpoint}/${row.id}/lock`, { locked }),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    const done = targets.length - failed;
    if (done > 0)
      toast.success(
        `${done} ${opts.noun}${done === 1 ? '' : 's'} ${locked ? 'locked' : 'unlocked'}.`,
      );
    if (failed > 0)
      toast.error(
        `${failed} ${opts.noun}${failed === 1 ? '' : 's'} could not be ${locked ? 'locked' : 'unlocked'}.`,
      );
    opts.reload();
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

  return {
    canLock,
    canUnlock,
    canToggle,
    toggleLock,
    lockAll,
    unlockAll,
    guardEdit,
    guardDelete,
    // Ready-to-pass bundle for the DataTable's `bulkLock` prop.
    bulkLock: { canLock, canUnlock, onLockAll: lockAll, onUnlockAll: unlockAll },
  };
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
