import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthUser } from './current-user.decorator';

/**
 * Allows the request only for super admins. Apply with `@UseGuards(SuperAdminGuard)`
 * on routes that must be super-admin-only (e.g. every master's lock/unlock
 * endpoint). Runs after the global JwtAuthGuard, so `request.user` is populated.
 *
 * Declarative replacement for calling `assertSuperAdmin(user)` by hand in each
 * handler — the authorization can't be forgotten when adding a new lock route.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as
      | AuthUser
      | undefined;
    if (!user?.isSuperAdmin) {
      throw new ForbiddenException(
        'Only super admins can perform this action.',
      );
    }
    return true;
  }
}
