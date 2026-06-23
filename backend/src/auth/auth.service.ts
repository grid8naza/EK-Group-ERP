import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

interface SubPriv {
  canMenu: boolean;
  canView: boolean;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canPrint: boolean;
  canDownloadPdf: boolean;
  canDownloadExcel: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
    // This is the web app — a user must have web access (mobile-only users are
    // blocked here). Super admins are exempt so they can't lock themselves out.
    if (!user.isSuperAdmin && !user.webEnabled) {
      throw new UnauthorizedException(
        'Web access is not enabled for this account',
      );
    }

    const token = await this.jwt.signAsync({
      sub: user.id,
      username: user.username,
    });

    const profile = await this.buildProfile(user.id);
    return { token, ...profile };
  }

  /**
   * Builds the user profile, the list of companies they can access, and the
   * navigation tree + permission map for the *active* company. Everything in
   * the cpanel (menus, objects, groups, gadgets, dashboards) is company-scoped,
   * so switching companies recomputes this whole payload.
   *
   * Super admins get everything in the active company.
   */
  async buildProfile(userId: number, requestedCompanyId?: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        groupAssignments: {
          select: { userGroup: { select: { id: true, companyId: true } } },
        },
        companies: {
          include: { company: true },
          orderBy: { company: { name: 'asc' } },
        },
      },
    });
    if (!user) throw new UnauthorizedException();

    // Companies this user may log into.
    const companies = user.companies
      .filter((uc) => uc.company.isActive)
      .map((uc) => ({
        id: uc.company.id,
        code: uc.company.code,
        name: uc.company.name,
        isDefault: uc.isDefault,
      }));

    // Pick the active company: requested → user default → first available.
    let activeCompanyId =
      requestedCompanyId && companies.some((c) => c.id === requestedCompanyId)
        ? requestedCompanyId
        : (companies.find((c) => c.isDefault)?.id ?? companies[0]?.id ?? null);

    // The module that loads automatically for the active company: the user's
    // per-company default, falling back to their global default module.
    const activeCompanyDefaultModuleId =
      user.companies.find((uc) => uc.company.id === activeCompanyId)
        ?.defaultModuleId ?? null;

    const profile = {
      id: user.id,
      userCode: user.userCode,
      username: user.username,
      name: user.name,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
      defaultModuleId: activeCompanyDefaultModuleId ?? user.defaultModuleId,
    };

    if (!activeCompanyId) {
      return {
        user: profile,
        companies,
        activeCompanyId: null,
        navigation: [],
        permissions: {},
      };
    }

    // These two queries are independent — run them concurrently to halve the
    // module-loading latency on the login / company-switch hot path.
    // - companyModules: modules enabled for the active company, joined to catalog.
    // - coreModules: universal modules (super-admin only), fetched directly with
    //   the same per-company menu/gadget data rather than via company_modules.
    const [companyModules, coreModules] = await Promise.all([
      this.prisma.companyModule.findMany({
        where: { companyId: activeCompanyId, isActive: true },
        include: {
          module: {
            include: {
              mainMenus: {
                where: { companyId: activeCompanyId },
                orderBy: { sortOrder: 'asc' },
                include: { subMenus: { orderBy: { sortOrder: 'asc' } } },
              },
              gadgets: {
                where: { companyId: activeCompanyId, isActive: true },
                orderBy: { sortOrder: 'asc' },
              },
            },
          },
        },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.module.findMany({
        where: { isCore: true, isActive: true },
        include: {
          mainMenus: {
            where: { companyId: activeCompanyId },
            orderBy: { sortOrder: 'asc' },
            include: { subMenus: { orderBy: { sortOrder: 'asc' } } },
          },
          gadgets: {
            where: { companyId: activeCompanyId, isActive: true },
            orderBy: { sortOrder: 'asc' },
          },
        },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);
    const linkedUserModules = companyModules
      .filter((cm) => cm.module.isActive && !cm.module.isCore)
      .map((cm) => cm.module);
    const enabledModules = [...coreModules, ...linkedUserModules].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );
    const enabledModuleIds = enabledModules.map((m) => m.id);

    // The user's groups *in this company*.
    const groupIds = user.groupAssignments
      .map((g) => g.userGroup)
      .filter((g) => g.companyId === activeCompanyId)
      .map((g) => g.id);

    // Modules the user's groups (in this company) manage. The top module
    // dropdown is validated against these: a module shows only if a group
    // grants it. Super admins bypass the group gate.
    let groupModuleIds: Set<number> | null = null;
    if (!user.isSuperAdmin) {
      const gm = groupIds.length
        ? await this.prisma.userGroupModule.findMany({
            where: { userGroupId: { in: groupIds } },
            select: { moduleId: true },
          })
        : [];
      groupModuleIds = new Set(gm.map((m) => m.moduleId));
    }

    // Modules explicitly assigned to this user in this company. When the user
    // has any assignment here, their list is further narrowed to it (already a
    // subset of the group modules). No assignments => all group modules show.
    const userModules = await this.prisma.userModule.findMany({
      where: { userId, companyId: activeCompanyId },
      select: { moduleId: true },
    });
    const assignedModuleIds = new Set(userModules.map((m) => m.moduleId));

    // Effective set = enabled ∩ group-managed ∩ (user-selected if any).
    const visibleModules = user.isSuperAdmin
      ? enabledModules
      : enabledModules.filter(
          (m) =>
            // Core modules are super-admin only.
            !m.isCore &&
            groupModuleIds!.has(m.id) &&
            (assignedModuleIds.size === 0 || assignedModuleIds.has(m.id)),
        );

    // Permissions (super admin => full access to everything in the company).
    let mainMenuVisible: Set<number> | null = null;
    const subPriv = new Map<number, SubPriv>();
    let allowedGadgetIds: Set<number> | null = null;

    if (!user.isSuperAdmin) {
      mainMenuVisible = new Set<number>();
      allowedGadgetIds = new Set<number>();
      if (groupIds.length) {
        const mainAccess = await this.prisma.groupMainMenuAccess.findMany({
          where: { userGroupId: { in: groupIds }, visible: true },
        });
        mainAccess.forEach((a) => mainMenuVisible!.add(a.mainMenuId));

        const subs = await this.prisma.groupSubMenuPrivilege.findMany({
          where: { userGroupId: { in: groupIds } },
        });
        for (const s of subs) {
          const cur = subPriv.get(s.subMenuId);
          subPriv.set(s.subMenuId, {
            canMenu: (cur?.canMenu ?? false) || s.canMenu,
            canView: (cur?.canView ?? false) || s.canView,
            canAdd: (cur?.canAdd ?? false) || s.canAdd,
            canEdit: (cur?.canEdit ?? false) || s.canEdit,
            canDelete: (cur?.canDelete ?? false) || s.canDelete,
            canPrint: (cur?.canPrint ?? false) || s.canPrint,
            canDownloadPdf: (cur?.canDownloadPdf ?? false) || s.canDownloadPdf,
            canDownloadExcel:
              (cur?.canDownloadExcel ?? false) || s.canDownloadExcel,
          });
        }

        const gg = await this.prisma.groupGadget.findMany({
          where: { userGroupId: { in: groupIds } },
        });
        gg.forEach((g) => allowedGadgetIds!.add(g.gadgetId));
      }
    }

    const visibleModuleIds = visibleModules.map((m) => m.id);

    // Dashboards the user may open in this company (their groups + shared).
    const dashboards = await this.prisma.dashboard.findMany({
      where: {
        companyId: activeCompanyId,
        moduleId: { in: visibleModuleIds.length ? visibleModuleIds : [-1] },
        isActive: true,
        ...(user.isSuperAdmin
          ? {}
          : { OR: [{ userGroupId: null }, { userGroupId: { in: groupIds } }] }),
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });

    const permissions: Record<
      string,
      {
        view: boolean;
        add: boolean;
        edit: boolean;
        delete: boolean;
        print: boolean;
        downloadPdf: boolean;
        downloadExcel: boolean;
      }
    > = {};

    const navigation = visibleModules.map((m) => {
      const menus = m.mainMenus
        .filter(
          (mm) =>
            user.isSuperAdmin || (mainMenuVisible && mainMenuVisible.has(mm.id)),
        )
        .map((mm) => {
          const items = mm.subMenus
            .filter((sm) =>
              user.isSuperAdmin ? true : subPriv.get(sm.id)?.canMenu,
            )
            .map((sm) => {
              const p = user.isSuperAdmin
                ? {
                    canView: true,
                    canAdd: true,
                    canEdit: true,
                    canDelete: true,
                    canPrint: true,
                    canDownloadPdf: true,
                    canDownloadExcel: true,
                  }
                : subPriv.get(sm.id);
              if (sm.route && p) {
                permissions[sm.route] = {
                  view: !!p.canView,
                  add: !!p.canAdd,
                  edit: !!p.canEdit,
                  delete: !!p.canDelete,
                  print: !!p.canPrint,
                  downloadPdf: !!p.canDownloadPdf,
                  downloadExcel: !!p.canDownloadExcel,
                };
              }
              return {
                id: sm.id,
                name: sm.subMenuName,
                route: sm.route,
                icon: sm.icon,
                objectType: sm.objectType,
              };
            });
          return {
            id: mm.id,
            name: mm.menuName,
            icon: mm.icon,
            objectType: mm.objectType,
            items,
          };
        })
        .filter((mm) => user.isSuperAdmin || mm.items.length > 0);

      const gadgets = m.gadgets
        .filter((g) => user.isSuperAdmin || allowedGadgetIds!.has(g.id))
        .map((g) => ({
          id: g.id,
          code: g.code,
          name: g.name,
          description: g.description,
        }));

      const moduleDashboards = dashboards
        .filter((d) => d.moduleId === m.id)
        .map((d) => ({
          id: d.id,
          name: d.name,
          icon: d.icon,
          route: `/dashboard/${d.id}`,
          isDefault: d.isDefault,
        }));

      return {
        id: m.id,
        code: m.code,
        name: m.name,
        icon: m.icon,
        menus,
        gadgets,
        dashboards: moduleDashboards,
      };
    });

    return {
      user: profile,
      companies,
      activeCompanyId,
      navigation,
      permissions,
    };
  }
}
