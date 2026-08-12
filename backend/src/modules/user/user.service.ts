import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { CreateUserDto, UpdateUserDto } from './user.dto';

const userSelect = {
  id: true,
  userCode: true,
  username: true,
  name: true,
  email: true,
  mobile: true,
  mobileMac: true,
  webEnabled: true,
  mobileEnabled: true,
  computerMac: true,
  securityType: true,
  isSuperAdmin: true,
  isActive: true,
  isLocked: true,
  remarks: true,
  defaultModuleId: true,
  createdAt: true,
  updatedAt: true,
  groupAssignments: {
    include: {
      userGroup: {
        select: { id: true, name: true, companyId: true },
      },
    },
  },
  companies: {
    select: {
      companyId: true,
      isDefault: true,
      defaultModuleId: true,
      company: { select: { id: true, code: true, name: true } },
    },
  },
  modules: { select: { companyId: true, moduleId: true } },
  branches: { select: { branchId: true, isDefault: true } },
} satisfies Prisma.UserSelect;

type RawUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;

// Flatten the join rows for the client.
function shape(user: RawUser) {
  // Group per-company module assignments: [{ companyId, moduleIds }].
  const byCompany = new Map<number, number[]>();
  for (const m of user.modules) {
    const arr = byCompany.get(m.companyId) ?? [];
    arr.push(m.moduleId);
    byCompany.set(m.companyId, arr);
  }
  // Per-company default module, keyed by companyId.
  const defaultModuleByCompany = new Map<number, number | null>(
    user.companies.map((c) => [c.companyId, c.defaultModuleId]),
  );
  return {
    ...user,
    groupIds: user.groupAssignments.map((g) => g.userGroupId),
    groups: user.groupAssignments.map((g) => g.userGroup),
    companyIds: user.companies.map((c) => c.companyId),
    branchIds: user.branches.map((b) => b.branchId),
    defaultBranchIds: user.branches
      .filter((b) => b.isDefault)
      .map((b) => b.branchId),
    companies: user.companies.map((c) => ({
      ...c.company,
      isDefault: c.isDefault,
      defaultModuleId: c.defaultModuleId,
    })),
    moduleAssignments: Array.from(byCompany.entries()).map(
      ([companyId, moduleIds]) => ({
        companyId,
        moduleIds,
        defaultModuleId: defaultModuleByCompany.get(companyId) ?? null,
      }),
    ),
  };
}

// The default module for a company is honoured only when it is one of the
// modules actually assigned to the user in that company; otherwise the caller's
// fallback (Workplace — see WORKPLACE_CODE below).
function resolveDefaultModule(
  companyId: number,
  assignments?: {
    companyId: number;
    moduleIds: number[];
    defaultModuleId?: number | null;
  }[],
  fallbackModuleId?: number | null,
): number | null {
  const fallback = fallbackModuleId ?? null;
  const a = assignments?.find((x) => x.companyId === companyId);
  if (!a || a.defaultModuleId == null) return fallback;
  return a.moduleIds.includes(a.defaultModuleId) ? a.defaultModuleId : fallback;
}

// Workplace is universal: it holds what is addressed to the PERSON rather than
// owned by a business domain (approvals, internal mail, chat, tasks), so every
// user carries it and lands on it when no other default is named. The scaffold
// sync asserts the same for every existing group and user; enforcing it here is
// what keeps it true for users created or edited afterwards. The module code is
// still WORKFLOW — only the label changed.
const WORKPLACE_CODE = 'WORKFLOW';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  /** The Workplace module's id, or null on a database that predates it. */
  private async workplaceModuleId(): Promise<number | null> {
    const mod = await this.prisma.module.findUnique({
      where: { code: WORKPLACE_CODE },
      select: { id: true },
    });
    return mod?.id ?? null;
  }

  /**
   * Add Workplace to every company in a module assignment. Pinning a user to a
   * module list is what hides the rest, so leaving it out of the list would take
   * the module away from that user however widely it is granted elsewhere.
   */
  private withWorkplace<T extends { companyId: number; moduleIds: number[] }>(
    assignments: T[],
    workplaceId: number | null,
  ): T[] {
    if (workplaceId == null) return assignments;
    return assignments.map((a) =>
      a.moduleIds.includes(workplaceId)
        ? a
        : { ...a, moduleIds: [...a.moduleIds, workplaceId] },
    );
  }

  async findAll(search?: string) {
    const users = await this.prisma.user.findMany({
      where: search
        ? {
            OR: [
              { username: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
              { userCode: { contains: search, mode: 'insensitive' } },
            ],
          }
        : undefined,
      select: userSelect,
      orderBy: { name: 'asc' },
    });
    return users.map(shape);
  }

  async findOne(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: userSelect,
    });
    if (!user) throw new NotFoundException('User not found');
    return shape(user);
  }

  async create(dto: CreateUserDto) {
    const {
      password,
      groupIds,
      companyIds,
      branchIds,
      defaultBranchIds,
      defaultCompanyId,
      moduleAssignments,
      ...rest
    } = dto;
    const passwordHash = await bcrypt.hash(password, 10);

    // Flatten per-company module assignments into UserModule rows — Workplace
    // always among them, and the module the user lands on unless the form named
    // another.
    const workplaceId = await this.workplaceModuleId();
    const assignments = this.withWorkplace(
      moduleAssignments ?? [],
      workplaceId,
    );
    const moduleRows = assignments.flatMap((a) =>
      a.moduleIds.map((moduleId) => ({ companyId: a.companyId, moduleId })),
    );

    // Keep only branches that belong to a company the user has access to.
    const branchRows = await this.resolveBranchRows(branchIds, companyIds);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          ...rest,
          defaultModuleId: rest.defaultModuleId ?? workplaceId ?? undefined,
          passwordHash,
          groupAssignments: groupIds?.length
            ? { create: groupIds.map((userGroupId) => ({ userGroupId })) }
            : undefined,
          companies: companyIds?.length
            ? {
                create: companyIds.map((companyId) => ({
                  companyId,
                  isDefault: companyId === defaultCompanyId,
                  defaultModuleId: resolveDefaultModule(
                    companyId,
                    assignments,
                    workplaceId,
                  ),
                })),
              }
            : undefined,
          modules: moduleRows.length ? { create: moduleRows } : undefined,
          branches: branchRows.length
            ? {
                create: branchRows.map((branchId) => ({
                  branchId,
                  isDefault: !!defaultBranchIds?.includes(branchId),
                })),
              }
            : undefined,
        },
        select: userSelect,
      });
      return shape(user);
    });
  }

  async update(id: number, dto: UpdateUserDto) {
    const existing = await this.ensureUser(id);
    assertUnlocked(existing, 'user', 'editing');
    const {
      password,
      groupIds,
      companyIds,
      branchIds,
      defaultBranchIds,
      defaultCompanyId,
      moduleAssignments,
      ...rest
    } = dto;

    const data: Prisma.UserUpdateInput = { ...rest };
    if (password) {
      data.passwordHash = await bcrypt.hash(password, 10);
    }

    // Workplace survives an edit: the assignment rows are replaced wholesale
    // below, so it has to be put back into the incoming list rather than
    // assumed to still be there.
    const workplaceId = await this.workplaceModuleId();
    const assignments =
      moduleAssignments === undefined
        ? undefined
        : this.withWorkplace(moduleAssignments, workplaceId);

    return this.prisma.$transaction(async (tx) => {
      if (groupIds !== undefined) {
        await tx.userGroupAssignment.deleteMany({ where: { userId: id } });
        if (groupIds.length) {
          await tx.userGroupAssignment.createMany({
            data: groupIds.map((userGroupId) => ({ userId: id, userGroupId })),
          });
        }
      }

      if (companyIds !== undefined) {
        // Preserve each company's saved default module when the caller isn't
        // also updating module assignments — otherwise recreating the rows
        // below would wipe every default to null. When moduleAssignments IS
        // provided, the block further down re-syncs defaults from it.
        const existingDefaults = new Map(
          (
            await tx.userCompany.findMany({
              where: { userId: id },
              select: { companyId: true, defaultModuleId: true },
            })
          ).map((r) => [r.companyId, r.defaultModuleId]),
        );
        await tx.userCompany.deleteMany({ where: { userId: id } });
        if (companyIds.length) {
          await tx.userCompany.createMany({
            data: companyIds.map((companyId) => ({
              userId: id,
              companyId,
              isDefault: companyId === defaultCompanyId,
              defaultModuleId:
                assignments !== undefined
                  ? resolveDefaultModule(companyId, assignments, workplaceId)
                  : (existingDefaults.get(companyId) ?? workplaceId ?? null),
            })),
          });
        }
      }

      if (assignments !== undefined) {
        await tx.userModule.deleteMany({ where: { userId: id } });
        const moduleRows = assignments.flatMap((a) =>
          a.moduleIds.map((moduleId) => ({
            userId: id,
            companyId: a.companyId,
            moduleId,
          })),
        );
        if (moduleRows.length) {
          await tx.userModule.createMany({ data: moduleRows });
        }

        // Keep each accessible company's default module in sync with the
        // assignment (covers the case where companies were left unchanged but
        // the default module selection changed). Clear stale defaults first.
        await tx.userCompany.updateMany({
          where: { userId: id },
          data: { defaultModuleId: null },
        });
        for (const a of assignments) {
          const def = resolveDefaultModule(
            a.companyId,
            assignments,
            workplaceId,
          );
          if (def != null) {
            await tx.userCompany.updateMany({
              where: { userId: id, companyId: a.companyId },
              data: { defaultModuleId: def },
            });
          }
        }
      }

      if (branchIds !== undefined) {
        // Valid companies = the set being saved now, else the user's current
        // set. A branch is kept only if its company is in that set.
        const validCompanyIds =
          companyIds ??
          (
            await tx.userCompany.findMany({
              where: { userId: id },
              select: { companyId: true },
            })
          ).map((c) => c.companyId);
        const branchRows = await this.resolveBranchRows(
          branchIds,
          validCompanyIds,
          tx,
        );
        await tx.userBranch.deleteMany({ where: { userId: id } });
        if (branchRows.length) {
          await tx.userBranch.createMany({
            data: branchRows.map((branchId) => ({
              userId: id,
              branchId,
              isDefault: !!defaultBranchIds?.includes(branchId),
            })),
          });
        }
      }

      const user = await tx.user.update({
        where: { id },
        data,
        select: userSelect,
      });
      return shape(user);
    });
  }

  /**
   * Filters the requested branch ids down to branches that actually exist and
   * belong to one of the user's accessible companies — so a user can never be
   * granted a branch of a company they can't enter.
   */
  private async resolveBranchRows(
    branchIds: number[] | undefined,
    companyIds: number[] | undefined,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<number[]> {
    if (!branchIds?.length || !companyIds?.length) return [];
    const branches = await tx.branch.findMany({
      where: { id: { in: branchIds }, companyId: { in: companyIds } },
      select: { id: true },
    });
    return branches.map((b) => b.id);
  }

  async setLock(id: number, locked: boolean) {
    const existing = await this.ensureUser(id);
    // The super admin account is permanently locked and can never be unlocked
    // (guards the single toggle and the bulk "Unlock all" alike).
    if (!locked && existing.isSuperAdmin) {
      throw new ForbiddenException(
        'The super admin account is permanently locked and cannot be unlocked.',
      );
    }
    return this.prisma.user.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const existing = await this.ensureUser(id);
    assertUnlocked(existing, 'user', 'deleting');
    await this.prisma.user.delete({ where: { id } });
    return { success: true };
  }

  private async ensureUser(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
