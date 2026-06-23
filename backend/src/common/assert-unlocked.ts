import { ConflictException } from '@nestjs/common';

/**
 * Throws if a cpanel master record is locked. Locked records must be unlocked
 * (super-admin only) before they can be edited or deleted. Centralizes the
 * guard that every lockable master service applies in update()/remove().
 */
export function assertUnlocked(
  record: { isLocked?: boolean } | null | undefined,
  noun: string,
  action: 'editing' | 'deleting' = 'editing',
): void {
  if (record?.isLocked) {
    throw new ConflictException(
      `This ${noun} is locked. Unlock it before ${action}.`,
    );
  }
}
