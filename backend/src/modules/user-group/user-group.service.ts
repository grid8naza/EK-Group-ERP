import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import {
  CreateUserGroupDto,
  UpdatePrivilegesDto,
  UpdateUserGroupDto,
} from './user-group.dto';

// The built-in full-access admin group (created by company-provisioning and
// granted new screens by the scaffold sync). Kept permanently locked.
const ADMIN_GROUP_NAME = 'Administrators';

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
        discountLevel: { select: { id: true, label: true } },
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
      include: {
        modules: { include: { module: true } },
        discountLevel: { select: { id: true, label: true } },
      },
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
    assertUnlocked(existing, 'user group', 'editing');
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
    const existing = await this.findOne(id);
    // The Administrators group is permanently locked: it protects the full-
    // access admin definition from edits/deletes, so it can never be unlocked
    // (guards the single toggle and the bulk "Unlock all" alike).
    if (!locked && existing.name === ADMIN_GROUP_NAME) {
      throw new ForbiddenException(
        'The Administrators group is permanently locked and cannot be unlocked.',
      );
    }
    return this.prisma.userGroup.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'user group', 'deleting');
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

    // Dashboards the group can be granted (per company + module, branch-aware).
    // Selecting two or more in a module makes all of them appear in that
    // module's dashboard menu for users in this group.
    const dashboardList = moduleIds.length
      ? await this.prisma.dashboard.findMany({
          where: {
            companyId: group.companyId,
            moduleId: { in: moduleIds },
            isActive: true,
          },
          include: { branch: { select: { id: true, name: true } } },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        })
      : [];

    const [mainAccess, subPrivs, groupDashboards] = await Promise.all([
      this.prisma.groupMainMenuAccess.findMany({
        where: { userGroupId: id },
      }),
      this.prisma.groupSubMenuPrivilege.findMany({
        where: { userGroupId: id },
      }),
      this.prisma.groupDashboard.findMany({ where: { userGroupId: id } }),
    ]);

    const mainMap = new Map(mainAccess.map((a) => [a.mainMenuId, a]));
    const subMap = new Map(subPrivs.map((p) => [p.subMenuId, p]));
    const selectedDashboards = new Set(groupDashboards.map((d) => d.dashboardId));

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
          canLock: priv?.canLock ?? false,
          canUnlock: priv?.canUnlock ?? false,
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
        dashboards: dashboardList
          .filter((d) => d.moduleId === mod.id)
          .map((d) => ({
            id: d.id,
            name: d.name,
            icon: d.icon,
            branchId: d.branchId,
            branchName: d.branch?.name ?? null,
            selected: selectedDashboards.has(d.id),
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
            canLock: p.canLock ?? false,
            canUnlock: p.canUnlock ?? false,
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
            canLock: p.canLock ?? false,
            canUnlock: p.canUnlock ?? false,
            canPrint: p.canPrint ?? false,
            canDownloadPdf: p.canDownloadPdf ?? false,
            canDownloadExcel: p.canDownloadExcel ?? false,
          },
        }),
      ),
    ];

    // Replace the group's dashboard selection when provided.
    if (dto.dashboardIds !== undefined) {
      ops.push(
        this.prisma.groupDashboard.deleteMany({ where: { userGroupId: id } }),
      );
      if (dto.dashboardIds.length) {
        ops.push(
          this.prisma.groupDashboard.createMany({
            data: dto.dashboardIds.map((dashboardId) => ({
              userGroupId: id,
              dashboardId,
            })),
          }),
        );
      }
    }

    await this.prisma.$transaction(ops);
    return this.getPrivileges(id);
  }
}
