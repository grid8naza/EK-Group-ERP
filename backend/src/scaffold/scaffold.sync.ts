import { ObjectType, Prisma } from '@prisma/client';
import { MODULE_SCAFFOLDS, type ModuleScaffold } from './module-scaffold';

/**
 * Idempotent, additive sync of the module/menu scaffold declared in
 * MODULE_SCAFFOLDS. Run once on every app start so a pulled codebase brings each
 * developer's database up to date without manual SQL or a reseed.
 *
 * It NEVER deletes or renames anything — it only creates what's missing:
 *  - upserts the module catalog (new modules show up in Module Master),
 *  - back-fills global Object Master entries per screen,
 *  - for each company, creates the module's main menu + missing sub-menus and
 *    grants the Administrators group full privileges on them.
 *
 * Core modules apply to every company. User modules are register-only (menus
 * created only where the module is enabled) unless `autoEnable` is set.
 */
export async function syncScaffold(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  // 1) Module catalog — register/update. Never flips an existing module's global
  //    isActive (preserves an admin's enable/disable choice).
  for (const m of MODULE_SCAFFOLDS) {
    await prisma.module.upsert({
      where: { code: m.code },
      update: {
        name: m.name,
        icon: m.icon,
        sortOrder: m.sortOrder,
        isCore: !!m.isCore,
        description: m.description,
      },
      create: {
        code: m.code,
        name: m.name,
        icon: m.icon,
        sortOrder: m.sortOrder,
        isCore: !!m.isCore,
        isActive: true,
        description: m.description,
      },
    });
  }

  const mods = await prisma.module.findMany({
    select: { id: true, code: true, sortOrder: true },
  });
  const byCode = new Map(mods.map((x) => [x.code, x]));

  for (const m of MODULE_SCAFFOLDS) {
    if (m.seedData) await m.seedData(prisma);
    const mod = byCode.get(m.code);
    if (!mod) continue;
    const hasMenu = (!!m.menu && !!m.subs?.length) || !!m.extraMenus?.length;
    if (!hasMenu) continue;
    await syncModuleMenus(prisma, m, mod.id, mod.sortOrder ?? m.sortOrder);
  }
}

/** A main menu and the screens it hosts, normalized from the scaffold. */
interface MenuGroup {
  name: string;
  icon: string;
  subs: { name: string; route: string; icon: string; order: number }[];
  /** The module's primary menu is matched by module (so a rename is reused);
   *  extra menus are matched by name, so they coexist with the primary. */
  primary: boolean;
}

async function syncModuleMenus(
  prisma: Prisma.TransactionClient,
  m: ModuleScaffold,
  moduleId: number,
  sortOrder: number,
): Promise<void> {
  // Normalize the module's main menus: the primary (menu + subs) plus any
  // extra named menus. Each is a separate MainMenu row.
  const menuGroups: MenuGroup[] = [
    ...(m.menu && m.subs?.length
      ? [{ name: m.menu.name, icon: m.menu.icon, subs: m.subs, primary: true }]
      : []),
    ...(m.extraMenus ?? []).map((e) => ({
      name: e.name,
      icon: e.icon,
      subs: e.subs,
      primary: false,
    })),
  ];
  const allSubs = menuGroups.flatMap((g) => g.subs);

  // ---- Global Object Master entries (one per screen, company-independent) ----
  const existingRoutes = new Set(
    (
      await prisma.objectMaster.findMany({
        where: { moduleId, objectType: ObjectType.FORM },
        select: { route: true },
      })
    ).map((o) => o.route),
  );
  for (const s of allSubs) {
    if (existingRoutes.has(s.route)) continue;
    await prisma.objectMaster.create({
      data: {
        moduleId,
        author: 'System',
        objectType: ObjectType.FORM,
        objectName: s.name,
        nameInMenu: s.name,
        showInMenu: true,
        route: s.route,
        icon: s.icon,
        isSystem: !!m.objectSystem,
        isLocked: !!m.objectSystem,
      },
    });
  }

  // ---- Which companies get this module's menu ----
  let companies: { id: number }[];
  if (m.isCore) {
    companies = await prisma.company.findMany({ select: { id: true } });
  } else if (m.autoEnable) {
    companies = await prisma.company.findMany({ select: { id: true } });
    for (const c of companies) {
      await prisma.companyModule.upsert({
        where: { companyId_moduleId: { companyId: c.id, moduleId } },
        update: { isActive: true },
        create: { companyId: c.id, moduleId, isActive: true, sortOrder },
      });
    }
  } else {
    // Register-only: menus only where an admin has enabled the module.
    companies = (
      await prisma.companyModule.findMany({
        where: { moduleId, isActive: true },
        select: { companyId: true },
      })
    ).map((e) => ({ id: e.companyId }));
  }

  for (const { id: companyId } of companies) {
    const admin = await prisma.userGroup.findFirst({
      where: { companyId, name: 'Administrators' },
      select: { id: true },
    });
    if (admin) {
      await prisma.userGroupModule.upsert({
        where: { userGroupId_moduleId: { userGroupId: admin.id, moduleId } },
        update: {},
        create: { userGroupId: admin.id, moduleId },
      });
    }

    let order = 0;
    for (const group of menuGroups) {
      order += 1;
      await syncOneMenu(prisma, {
        companyId,
        moduleId,
        group,
        sortOrder: order,
        adminGroupId: admin?.id,
      });
    }
  }
}

/** Find/create one main menu, back-fill its sub-menus, and grant the admin group. */
async function syncOneMenu(
  prisma: Prisma.TransactionClient,
  opts: {
    companyId: number;
    moduleId: number;
    group: MenuGroup;
    sortOrder: number;
    adminGroupId?: number;
  },
): Promise<void> {
  const { companyId, moduleId, group, sortOrder, adminGroupId } = opts;

  // Primary menu: reuse the module's existing main menu (matched by module, so a
  // renamed menu is reused). Extra menus: matched by name so they don't collide
  // with the primary and are found/created independently.
  let main = await prisma.mainMenu.findFirst({
    where: group.primary
      ? { companyId, moduleId }
      : { companyId, moduleId, menuName: group.name },
    orderBy: { id: 'asc' },
  });
  if (!main) {
    main = await prisma.mainMenu.create({
      data: {
        companyId,
        moduleId,
        menuName: group.name,
        sortOrder,
        objectType: ObjectType.FORM,
        isUserMenu: true,
        icon: group.icon,
      },
    });
  }

  // Missing sub-menus (matched by route).
  const have = new Set(
    (
      await prisma.subMenu.findMany({
        where: { mainMenuId: main.id },
        select: { route: true },
      })
    ).map((s) => s.route),
  );
  const missing = group.subs.filter((s) => !have.has(s.route));
  if (missing.length) {
    await prisma.subMenu.createMany({
      data: missing.map((s) => ({
        mainMenuId: main!.id,
        subMenuName: s.name,
        route: s.route,
        icon: s.icon,
        sortOrder: s.order,
        objectType: ObjectType.FORM,
      })),
    });
  }

  // Grant the Administrators group full privileges on the menu + all its subs.
  if (adminGroupId) {
    await prisma.groupMainMenuAccess.upsert({
      where: {
        userGroupId_mainMenuId: {
          userGroupId: adminGroupId,
          mainMenuId: main.id,
        },
      },
      update: { visible: true },
      create: { userGroupId: adminGroupId, mainMenuId: main.id, visible: true },
    });
    const subs = await prisma.subMenu.findMany({
      where: { mainMenuId: main.id },
      select: { id: true },
    });
    await prisma.groupSubMenuPrivilege.createMany({
      data: subs.map((sub) => ({
        userGroupId: adminGroupId,
        subMenuId: sub.id,
        canMenu: true,
        canView: true,
        canAdd: true,
        canEdit: true,
        canDelete: true,
        canLock: true,
        canUnlock: true,
        canPrint: true,
        canDownloadPdf: true,
        canDownloadExcel: true,
      })),
      skipDuplicates: true,
    });
  }
}
