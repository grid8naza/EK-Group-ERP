import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AudienceOptions,
  AudienceSpec,
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

  /**
   * Everybody the user works alongside — active users sharing at least one of
   * their companies, plus every super admin (who belong to no company in
   * particular and must still be reachable).
   *
   * A super admin asking gets every active user back, for the same reason.
   */
  async findPeers(userId: number): Promise<UserSummary[]> {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });
    if (!me) return [];

    if (me.isSuperAdmin) {
      return this.prisma.user.findMany({
        where: { isActive: true, id: { not: userId } },
        select: this.summarySelect,
        orderBy: { name: 'asc' },
      });
    }

    const companyIds = (
      await this.prisma.userCompany.findMany({
        where: { userId },
        select: { companyId: true },
      })
    ).map((c) => c.companyId);

    return this.prisma.user.findMany({
      where: {
        isActive: true,
        id: { not: userId },
        OR: [
          { isSuperAdmin: true },
          { companies: { some: { companyId: { in: companyIds } } } },
        ],
      },
      select: this.summarySelect,
      orderBy: { name: 'asc' },
    });
  }

  // ------------------------------------------------------------- audiences --

  /**
   * What this user may aim a circular or a broadcast at: their own companies
   * (every active one, for a super admin), the branches under those, and the
   * role groups belonging to them.
   */
  async audienceOptions(userId: number): Promise<AudienceOptions> {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });
    if (!me) {
      return { companies: [], branches: [], groups: [], everyoneCount: 0 };
    }

    const companies = await this.prisma.company.findMany({
      where: {
        isActive: true,
        ...(me.isSuperAdmin ? {} : { users: { some: { userId } } }),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const companyIds = companies.map((c) => c.id);

    const [branches, groups, peers] = await Promise.all([
      this.prisma.branch.findMany({
        where: { isActive: true, companyId: { in: companyIds } },
        select: { id: true, name: true, companyId: true },
        orderBy: [{ companyId: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.userGroup.findMany({
        where: { companyId: { in: companyIds } },
        select: { id: true, name: true, companyId: true },
        orderBy: [{ companyId: 'asc' }, { name: 'asc' }],
      }),
      this.findPeers(userId),
    ]);

    return { companies, branches, groups, everyoneCount: peers.length };
  }

  /**
   * Who an audience actually reaches: for each company, whoever is in one of
   * its chosen branches AND in one of its chosen roles, all of them added
   * together, plus anybody named outright.
   *
   * Worked out per company rather than over the whole selection, because the
   * picker asks the question per company and the answer has to mean what the
   * screen said. Pooling them would let a branch ticked under Bake House pair
   * with a role ticked under Regency Bakers and reach somebody neither list
   * chose.
   *
   * The reachable set is findPeers throughout — the same "who can I write to"
   * the rest of the app answers — so no audience can be assembled that reaches
   * further than naming everybody by hand would.
   */
  async resolveAudience(
    userId: number,
    spec: AudienceSpec,
  ): Promise<number[]> {
    const peers = await this.findPeers(userId);
    const reach = new Set(peers.map((p) => p.id));
    if (spec.everyone) return [...reach];

    const branchIds = [...new Set(spec.branchIds ?? [])];
    const groupIds = [...new Set(spec.userGroupIds ?? [])];
    const hit = new Set<number>();

    if (branchIds.length > 0 || groupIds.length > 0) {
      const [branches, groups] = await Promise.all([
        this.prisma.branch.findMany({
          where: { id: { in: branchIds } },
          select: { id: true, companyId: true },
        }),
        this.prisma.userGroup.findMany({
          where: { id: { in: groupIds } },
          select: { id: true, companyId: true },
        }),
      ]);

      // What was picked under each company's heading.
      const picked = new Map<number, { branches: Set<number>; roles: Set<number> }>();
      const under = (companyId: number) => {
        const found = picked.get(companyId);
        if (found) return found;
        const fresh = { branches: new Set<number>(), roles: new Set<number>() };
        picked.set(companyId, fresh);
        return fresh;
      };
      for (const b of branches) under(b.companyId).branches.add(b.id);
      for (const g of groups) under(g.companyId).roles.add(g.id);

      // A company with no branches at all cannot be asked for one — its roles
      // stand alone, or it could never be written to.
      const branched = new Set(
        (
          await this.prisma.branch.findMany({
            where: { companyId: { in: [...picked.keys()] }, isActive: true },
            select: { companyId: true },
          })
        ).map((b) => b.companyId),
      );

      const [branchRows, roleRows] = await Promise.all([
        branchIds.length
          ? this.prisma.userBranch.findMany({
              where: { branchId: { in: branchIds } },
              select: { userId: true, branchId: true },
            })
          : Promise.resolve([] as { userId: number; branchId: number }[]),
        groupIds.length
          ? this.prisma.userGroupAssignment.findMany({
              where: { userGroupId: { in: groupIds } },
              select: { userId: true, userGroupId: true },
            })
          : Promise.resolve([] as { userId: number; userGroupId: number }[]),
      ]);

      for (const [companyId, choice] of picked) {
        const needsBranch = branched.has(companyId);
        // Half a rule reaches nobody — see the port's resolveAudience note.
        if (choice.roles.size === 0) continue;
        if (needsBranch && choice.branches.size === 0) continue;

        const inBranch = new Set(
          branchRows
            .filter((r) => choice.branches.has(r.branchId))
            .map((r) => r.userId),
        );
        for (const row of roleRows) {
          if (!choice.roles.has(row.userGroupId)) continue;
          if (!reach.has(row.userId)) continue;
          if (needsBranch && !inBranch.has(row.userId)) continue;
          hit.add(row.userId);
        }
      }
    }

    // Named people are an addition, never filtered — see AudienceSpec.userIds.
    for (const id of spec.userIds ?? []) {
      if (reach.has(id)) hit.add(id);
    }
    return [...hit];
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
