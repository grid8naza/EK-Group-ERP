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
}
