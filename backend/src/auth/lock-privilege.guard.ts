import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  mixin,
  Type,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './current-user.decorator';

/**
 * Guards a master's lock/unlock endpoint behind the screen's `lock` / `unlock`
 * privilege (the same flags granted in the Privileges screen). Locking a record
 * requires `canLock`, unlocking requires `canUnlock`; super admins always pass.
 *
 * `route` is the screen route stored on the SubMenu (e.g. '/inventory/units') —
 * the same route the frontend's useLock() checks via can(route, 'lock'|'unlock'),
 * so backend enforcement and the button's visibility stay in lockstep.
 *
 * Returns a fresh mixin guard per route so it can be applied inline:
 *   @UseGuards(LockPrivilegeGuard('/inventory/units'))
 *
 * Runs after the global JwtAuthGuard, so `request.user` is already populated.
 */
export function LockPrivilegeGuard(route: string): Type<CanActivate> {
  @Injectable()
  class LockPrivilegeMixin implements CanActivate {
    constructor(readonly prisma: PrismaService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const req = context.switchToHttp().getRequest();
      const user = req.user as AuthUser | undefined;
      if (!user) throw new ForbiddenException('Not authenticated.');
      if (user.isSuperAdmin) return true;

      // Lock vs unlock decides which privilege is required.
      const locking = req.body?.locked === true || req.body?.locked === 'true';
      const needed: 'canLock' | 'canUnlock' = locking ? 'canLock' : 'canUnlock';

      // Active company (X-Company-Id header, else the user's default company),
      // matching how privileges are scoped per company in the login profile.
      const raw = req.headers['x-company-id'];
      let companyId = Number(Array.isArray(raw) ? raw[0] : raw);
      if (!Number.isFinite(companyId) || companyId <= 0) {
        const def = await this.prisma.userCompany.findFirst({
          where: { userId: user.id, isDefault: true },
          select: { companyId: true },
        });
        companyId = def?.companyId ?? 0;
      }

      // OR across the user's groups in this company — same combination rule the
      // login profile uses to build permissions[route].
      const privs = await this.prisma.groupSubMenuPrivilege.findMany({
        where: {
          subMenu: { route },
          userGroup: {
            companyId,
            userAssignments: { some: { userId: user.id } },
          },
        },
        select: { canLock: true, canUnlock: true },
      });

      const allowed = privs.some((p) =>
        needed === 'canLock' ? p.canLock : p.canUnlock,
      );
      if (!allowed) {
        throw new ForbiddenException(
          locking
            ? 'You do not have permission to lock this record.'
            : 'You do not have permission to unlock this record.',
        );
      }
      return true;
    }
  }
  return mixin(LockPrivilegeMixin);
}
