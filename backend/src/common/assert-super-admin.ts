import { ForbiddenException } from '@nestjs/common';
import { AuthUser } from '../auth/current-user.decorator';

/** Throws unless the current user is a super admin. Used to guard lock/unlock. */
export function assertSuperAdmin(user: AuthUser | undefined): void {
  if (!user?.isSuperAdmin) {
    throw new ForbiddenException('Only super admins can lock or unlock records.');
  }
}
