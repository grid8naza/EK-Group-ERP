import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
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
// modules actually assigned to the user in that company; otherwise null.
function resolveDefaultModule(
  companyId: number,
  assignments?: { companyId: number; moduleIds: number[]; defaultModuleId?: number | null }[],
): number | null {
  const a = assignments?.find((x) => x.companyId === companyId);
  if (!a || a.defaultModuleId == null) return null;
  return a.moduleIds.includes(a.defaultModuleId) ? a.defaultModuleId : null;
}

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

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
      defaultCompanyId,
      moduleAssignments,
      ...rest
    } = dto;
    const passwordHash = await bcrypt.hash(password, 10);

    // Flatten per-company module assignments into UserModule rows.
    const moduleRows = (moduleAssignments ?? []).flatMap((a) =>
      a.moduleIds.map((moduleId) => ({ companyId: a.companyId, moduleId })),
    );

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          ...rest,
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
                    moduleAssignments,
                  ),
                })),
              }
            : undefined,
          modules: moduleRows.length ? { create: moduleRows } : undefined,
        },
        select: userSelect,
      });
      return shape(user);
    });
  }

  async update(id: number, dto: UpdateUserDto) {
    await this.ensureUser(id);
    const {
      password,
      groupIds,
      companyIds,
      defaultCompanyId,
      moduleAssignments,
      ...rest
    } = dto;

    const data: Prisma.UserUpdateInput = { ...rest };
    if (password) {
      data.passwordHash = await bcrypt.hash(password, 10);
    }

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
        await tx.userCompany.deleteMany({ where: { userId: id } });
        if (companyIds.length) {
          await tx.userCompany.createMany({
            data: companyIds.map((companyId) => ({
              userId: id,
              companyId,
              isDefault: companyId === defaultCompanyId,
              defaultModuleId: resolveDefaultModule(companyId, moduleAssignments),
            })),
          });
        }
      }

      if (moduleAssignments !== undefined) {
        await tx.userModule.deleteMany({ where: { userId: id } });
        const moduleRows = moduleAssignments.flatMap((a) =>
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
        for (const a of moduleAssignments) {
          const def = resolveDefaultModule(a.companyId, moduleAssignments);
          if (def != null) {
            await tx.userCompany.updateMany({
              where: { userId: id, companyId: a.companyId },
              data: { defaultModuleId: def },
            });
          }
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

  async remove(id: number) {
    await this.ensureUser(id);
    await this.prisma.user.delete({ where: { id } });
    return { success: true };
  }

  private async ensureUser(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
