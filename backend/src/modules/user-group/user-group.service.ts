import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateUserGroupDto,
  UpdatePrivilegesDto,
  UpdateUserGroupDto,
} from './user-group.dto';

@Injectable()
export class UserGroupService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: number, moduleId?: number) {
    const groups = await this.prisma.userGroup.findMany({
      where: {
        companyId,
        ...(moduleId ? { modules: { some: { moduleId } } } : {}),
      },
      include: {
        modules: { include: { module: true } },
        _count: { select: { userAssignments: true } },
      },
      orderBy: { name: 'asc' },
    });
    // Flatten the join rows to a plain list of modules.
    return groups.map((g) => ({
      ...g,
      modules: g.modules.map((m) => m.module),
    }));
  }

  async findOne(id: number) {
    const group = await this.prisma.userGroup.findUnique({
      where: { id },
      include: { modules: { include: { module: true } } },
    });
    if (!group) throw new NotFoundException('User group not found');
    return { ...group, modules: group.modules.map((m) => m.module) };
  }

  // Core modules are super-admin only and cannot be granted to a user group.
  private async withoutCoreModules(moduleIds: number[]) {
    if (!moduleIds.length) return moduleIds;
    const core = await this.prisma.module.findMany({
      where: { id: { in: moduleIds }, isCore: true },
      select: { id: true },
    });
    const coreSet = new Set(core.map((c) => c.id));
    return moduleIds.filter((mId) => !coreSet.has(mId));
  }

  async create(dto: CreateUserGroupDto, companyId: number) {
    const { moduleIds: rawIds, ...rest } = dto;
    const moduleIds = await this.withoutCoreModules(rawIds);
    const group = await this.prisma.userGroup.create({
      data: {
        ...rest,
        companyId,
        modules: { create: moduleIds.map((moduleId) => ({ moduleId })) },
      },
    });
    return this.findOne(group.id);
  }

  async update(id: number, dto: UpdateUserGroupDto) {
    const existing = await this.findOne(id);
    if (existing.isLocked) {
      throw new ConflictException(
        'This user group is locked. Unlock it before editing.',
      );
    }
    const { moduleIds: rawIds, ...rest } = dto;
    const moduleIds = rawIds ? await this.withoutCoreModules(rawIds) : rawIds;

    const ops: any[] = [
      this.prisma.userGroup.update({ where: { id }, data: rest }),
    ];

    if (moduleIds) {
      const oldIds = existing.modules.map((m) => m.id);
      const removed = oldIds.filter((m) => !moduleIds.includes(m));

      // Reset the module links to the new set.
      ops.push(
        this.prisma.userGroupModule.deleteMany({ where: { userGroupId: id } }),
      );
      if (moduleIds.length) {
        ops.push(
          this.prisma.userGroupModule.createMany({
            data: moduleIds.map((moduleId) => ({ userGroupId: id, moduleId })),
          }),
        );
      }

      // Revoking a module also clears the privileges for its menus, so users
      // stop seeing them (buildProfile is driven purely by these rows).
      if (removed.length) {
        ops.push(
          this.prisma.groupMainMenuAccess.deleteMany({
            where: { userGroupId: id, mainMenu: { moduleId: { in: removed } } },
          }),
        );
        ops.push(
          this.prisma.groupSubMenuPrivilege.deleteMany({
            where: {
              userGroupId: id,
              subMenu: { mainMenu: { moduleId: { in: removed } } },
            },
          }),
        );
      }
    }

    await this.prisma.$transaction(ops);
    return this.findOne(id);
  }

  async setLock(id: number, locked: boolean) {
    await this.findOne(id);
    return this.prisma.userGroup.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const existing = await this.findOne(id);
    if (existing.isLocked) {
      throw new ConflictException(
        'This user group is locked. Unlock it before deleting.',
      );
    }
    await this.prisma.userGroup.delete({ where: { id } });
    return { success: true };
  }

  async getPrivileges(id: number) {
    const group = await this.findOne(id);
    const moduleIds = group.modules.map((m) => m.id);

    // Main menus are per-company, so scope to the group's company — otherwise
    // a module shared across companies would surface duplicate main menus.
    const mainMenus = moduleIds.length
      ? await this.prisma.mainMenu.findMany({
          where: { companyId: group.companyId, moduleId: { in: moduleIds } },
          include: { subMenus: { orderBy: { sortOrder: 'asc' } } },
          orderBy: { sortOrder: 'asc' },
        })
      : [];

    const gadgetList = moduleIds.length
      ? await this.prisma.gadget.findMany({
          where: {
            companyId: group.companyId,
            moduleId: { in: moduleIds },
            isActive: true,
          },
          orderBy: { sortOrder: 'asc' },
        })
      : [];

    const [mainAccess, subPrivs, groupGadgets] = await Promise.all([
      this.prisma.groupMainMenuAccess.findMany({
        where: { userGroupId: id },
      }),
      this.prisma.groupSubMenuPrivilege.findMany({
        where: { userGroupId: id },
      }),
      this.prisma.groupGadget.findMany({ where: { userGroupId: id } }),
    ]);

    const mainMap = new Map(mainAccess.map((a) => [a.mainMenuId, a]));
    const subMap = new Map(subPrivs.map((p) => [p.subMenuId, p]));
    const selectedGadgets = new Set(groupGadgets.map((g) => g.gadgetId));

    const buildNode = (mainMenu: (typeof mainMenus)[number]) => ({
      mainMenu: {
        id: mainMenu.id,
        menuName: mainMenu.menuName,
        icon: mainMenu.icon,
      },
      visible: mainMap.get(mainMenu.id)?.visible ?? false,
      subMenus: mainMenu.subMenus.map((sub) => {
        const priv = subMap.get(sub.id);
        return {
          id: sub.id,
          subMenuName: sub.subMenuName,
          objectType: sub.objectType,
          canMenu: priv?.canMenu ?? false,
          canView: priv?.canView ?? false,
          canAdd: priv?.canAdd ?? false,
          canEdit: priv?.canEdit ?? false,
          canDelete: priv?.canDelete ?? false,
          canPrint: priv?.canPrint ?? false,
          canDownloadPdf: priv?.canDownloadPdf ?? false,
          canDownloadExcel: priv?.canDownloadExcel ?? false,
        };
      }),
    });

    // Group the menu tree by module so the UI can show a heading per module.
    const modules = group.modules
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((mod) => ({
        module: { id: mod.id, code: mod.code, name: mod.name, icon: mod.icon },
        tree: mainMenus.filter((mm) => mm.moduleId === mod.id).map(buildNode),
        gadgets: gadgetList
          .filter((g) => g.moduleId === mod.id)
          .map((g) => ({
            id: g.id,
            code: g.code,
            name: g.name,
            description: g.description,
            selected: selectedGadgets.has(g.id),
          })),
      }));

    return { group, modules };
  }

  async updatePrivileges(id: number, dto: UpdatePrivilegesDto) {
    await this.findOne(id);

    const ops: any[] = [
      ...dto.mainMenuAccess.map((a) =>
        this.prisma.groupMainMenuAccess.upsert({
          where: {
            userGroupId_mainMenuId: {
              userGroupId: id,
              mainMenuId: a.mainMenuId,
            },
          },
          create: {
            userGroupId: id,
            mainMenuId: a.mainMenuId,
            visible: a.visible,
          },
          update: { visible: a.visible },
        }),
      ),
      ...dto.subMenuPrivileges.map((p) =>
        this.prisma.groupSubMenuPrivilege.upsert({
          where: {
            userGroupId_subMenuId: {
              userGroupId: id,
              subMenuId: p.subMenuId,
            },
          },
          create: {
            userGroupId: id,
            subMenuId: p.subMenuId,
            canMenu: p.canMenu,
            canView: p.canView,
            canAdd: p.canAdd,
            canEdit: p.canEdit,
            canDelete: p.canDelete,
            canPrint: p.canPrint ?? false,
            canDownloadPdf: p.canDownloadPdf ?? false,
            canDownloadExcel: p.canDownloadExcel ?? false,
          },
          update: {
            canMenu: p.canMenu,
            canView: p.canView,
            canAdd: p.canAdd,
            canEdit: p.canEdit,
            canDelete: p.canDelete,
            canPrint: p.canPrint ?? false,
            canDownloadPdf: p.canDownloadPdf ?? false,
            canDownloadExcel: p.canDownloadExcel ?? false,
          },
        }),
      ),
    ];

    // Replace the group's gadget selection when provided.
    if (dto.gadgetIds !== undefined) {
      ops.push(
        this.prisma.groupGadget.deleteMany({ where: { userGroupId: id } }),
      );
      if (dto.gadgetIds.length) {
        ops.push(
          this.prisma.groupGadget.createMany({
            data: dto.gadgetIds.map((gadgetId) => ({
              userGroupId: id,
              gadgetId,
            })),
          }),
        );
      }
    }

    await this.prisma.$transaction(ops);
    return this.getPrivileges(id);
  }
}
