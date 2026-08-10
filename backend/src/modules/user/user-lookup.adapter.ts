import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UserLookupPort,
  UserSummary,
} from '../../contracts/user-lookup.port';

/**
 * The User (Cpanel) module's in-process implementation of UserLookupPort.
 *
 * It talks only to its own tables via Prisma and returns the small UserSummary
 * shape — never a Prisma entity. When this module is split into its own service,
 * this file is replaced by a remote client implementing the same port; nothing
 * on the consumer side changes.
 *
 * Allowed imports here: prisma (shared) + contracts (the port). It must NOT
 * import any other feature module — `npm run lint:boundaries` enforces that.
 */
@Injectable()
export class UserLookupAdapter implements UserLookupPort {
  constructor(private readonly prisma: PrismaService) {}

  private readonly summarySelect = {
    id: true,
    userCode: true,
    username: true,
    name: true,
    email: true,
    isActive: true,
  } as const;

  findById(id: number): Promise<UserSummary | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: this.summarySelect,
    });
  }

  findByIds(ids: number[]): Promise<UserSummary[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: this.summarySelect,
    });
  }

  async usersInGroup(userGroupId: number): Promise<number[]> {
    const rows = await this.prisma.userGroupAssignment.findMany({
      where: { userGroupId, user: { isActive: true } },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  async canAccessCompany(userId: number, companyId: number): Promise<boolean> {
    const row = await this.prisma.userCompany.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * The same effective-access rule the login profile builds its module list
   * from (see AuthService): enabled for the company, managed by one of the
   * user's groups THERE, and — where the user has an assignment of their own in
   * that company — in it. A user with no assignment inherits their groups'
   * modules, which is what makes "assign nothing" mean "everything the role
   * has" rather than "nothing at all".
   *
   * Deliberately re-derived rather than trusted from a token: a workflow asks
   * this months after somebody logged in.
   */
  async canAccessModule(
    userId: number,
    companyId: number,
    moduleId: number,
  ): Promise<boolean> {
    const [user, module] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { isSuperAdmin: true, isActive: true },
      }),
      this.prisma.module.findUnique({
        where: { id: moduleId },
        select: { isActive: true, isCore: true },
      }),
    ]);
    if (!user?.isActive || !module?.isActive) return false;

    // A core module is enabled everywhere and belongs to super admins alone.
    if (module.isCore) return user.isSuperAdmin;

    const enabled = await this.prisma.companyModule.findFirst({
      where: { companyId, moduleId, isActive: true },
      select: { id: true },
    });
    if (!enabled) return false;
    if (user.isSuperAdmin) return true;

    const groupIds = (
      await this.prisma.userGroupAssignment.findMany({
        where: { userId, userGroup: { companyId } },
        select: { userGroupId: true },
      })
    ).map((g) => g.userGroupId);
    if (!groupIds.length) return false;

    const managed = await this.prisma.userGroupModule.findFirst({
      where: { userGroupId: { in: groupIds }, moduleId },
      select: { id: true },
    });
    if (!managed) return false;

    const own = await this.prisma.userModule.findMany({
      where: { userId, companyId },
      select: { moduleId: true },
    });
    return own.length === 0 || own.some((m) => m.moduleId === moduleId);
  }
}
