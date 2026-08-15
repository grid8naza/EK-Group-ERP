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
 * Guards an endpoint behind one TAB of a screen being visible to the caller —
 * the same tick an admin sets in Cpanel → User Groups & Privileges, and the
 * same answer the frontend's `canTab(route, key)` gives.
 *
 * Applied inline, one mixin per tab:
 *   @UseGuards(TabPrivilegeGuard('/hr/employees', 'access'))
 *
 * A tab nobody has hidden is VISIBLE, which is the rule the whole feature is
 * built on (see GroupSubMenuTabAccess) — so this asks whether the tab has been
 * TAKEN AWAY, not whether it has been granted. Two further conditions come with
 * it, because a tab is part of a screen rather than a thing of its own:
 *
 *   · the screen itself must be reachable (canMenu on any of the user's groups)
 *   · the tab must not be hidden by every one of those groups
 *
 * Hidden-by-every-group rather than by any: belonging to a second group only
 * ever widens what somebody can see, so one group that leaves the tab alone is
 * one grant of it. That matches how the login profile resolves the same thing.
 *
 * Super admins always pass. Runs after the global JwtAuthGuard, so
 * `request.user` is already populated.
 */
export function TabPrivilegeGuard(
  route: string,
  tabKey: string,
  /** What the caller is refused with — said in terms of the screen, not the table. */
  message = 'You do not have permission to use this tab.',
): Type<CanActivate> {
  @Injectable()
  class TabPrivilegeMixin implements CanActivate {
    constructor(readonly prisma: PrismaService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const req = context.switchToHttp().getRequest();
      const user = req.user as AuthUser | undefined;
      if (!user) throw new ForbiddenException('Not authenticated.');
      if (user.isSuperAdmin) return true;

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

      const groups = await this.prisma.userGroup.findMany({
        where: { companyId, userAssignments: { some: { userId: user.id } } },
        select: { id: true },
      });
      if (!groups.length) throw new ForbiddenException(message);
      const groupIds = groups.map((g) => g.id);

      // Can they reach the screen at all?
      const reachable = await this.prisma.groupSubMenuPrivilege.findFirst({
        where: {
          canMenu: true,
          subMenu: { route },
          userGroupId: { in: groupIds },
        },
        select: { id: true },
      });
      if (!reachable) throw new ForbiddenException(message);

      // Is the tab hidden by EVERY group they are in? A tab with no row is not
      // hidden, so a group that has never been asked about it counts as leaving
      // it alone — which is a grant.
      const tab = await this.prisma.subMenuTab.findFirst({
        where: { key: tabKey, subMenu: { route, mainMenu: { companyId } } },
        select: { id: true },
      });
      // No such tab is not a locked door: the screen simply does not declare
      // one, so there is nothing here to withhold.
      if (!tab) return true;

      const hiding = await this.prisma.groupSubMenuTabAccess.count({
        where: {
          subMenuTabId: tab.id,
          userGroupId: { in: groupIds },
          visible: false,
        },
      });
      if (hiding >= groupIds.length) throw new ForbiddenException(message);
      return true;
    }
  }
  return mixin(TabPrivilegeMixin);
}
