import { ObjectType, Prisma } from '@prisma/client';
import { MODULE_SCAFFOLDS, type ModuleScaffold } from './module-scaffold';

/**
 * Screen routes that were renamed or removed. The additive sync below never
 * deletes on its own, so a renamed screen's old SubMenu / ObjectMaster (and the
 * privileges hanging off them) would linger in every developer's DB. List the
 * dead routes here to have them cleaned up idempotently on the next boot.
 * Deleting the SubMenu cascades to its GroupSubMenuPrivilege rows.
 */
const RETIRED_ROUTES: string[] = [
  '/inventory/products', // split into products-unpacked + products-packed
  '/crm/place-order', // renamed to /crm/purchase-orders-ic
  '/inventory/opening-stock', // split into items / products-packed / products-unpacked
  '/inventory/opening-stock-items', // split into raw-material + packing-material
  '/inventory/opening-stock-products-packed', // renamed to opening-stock-packed-products
  '/inventory/opening-stock-products-unpacked', // renamed to opening-stock-unpacked-products
];

async function cleanupRetiredRoutes(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  if (RETIRED_ROUTES.length === 0) return;
  await prisma.subMenu.deleteMany({ where: { route: { in: RETIRED_ROUTES } } });
  await prisma.objectMaster.deleteMany({
    where: { route: { in: RETIRED_ROUTES } },
  });
}

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
  // 0) Retire routes that were renamed/removed. The steps below never delete,
  //    so a renamed screen's old menu/object would otherwise linger.
  await cleanupRetiredRoutes(prisma);

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
  subs: {
    name: string;
    route: string;
    icon: string;
    order: number;
    objectType?: ObjectType;
    superAdminOnly?: boolean;
  }[];
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
  // Match by route across ALL types (not just FORM) so a report screen isn't
  // duplicated every boot, and so a screen mistyped earlier can be reconciled.
  const existingObjects = new Map(
    (
      await prisma.objectMaster.findMany({
        where: { moduleId },
        select: { route: true, objectType: true },
      })
    ).map((o) => [o.route, o.objectType]),
  );
  for (const s of allSubs) {
    const objectType = s.objectType ?? ObjectType.FORM;
    const current = existingObjects.get(s.route);
    if (current === undefined) {
      await prisma.objectMaster.create({
        data: {
          moduleId,
          author: 'System',
          objectType,
          objectName: s.name,
          nameInMenu: s.name,
          showInMenu: true,
          route: s.route,
          icon: s.icon,
          isSystem: !!m.objectSystem,
          isLocked: !!m.objectSystem,
        },
      });
    } else if (current !== objectType) {
      // Reconcile a screen seeded with the wrong kind (e.g. a report that was
      // created as FORM before it was tagged REPORT).
      await prisma.objectMaster.updateMany({
        where: { moduleId, route: s.route },
        data: { objectType },
      });
    }
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
  const existingSubs = new Map(
    (
      await prisma.subMenu.findMany({
        where: { mainMenuId: main.id },
        select: { id: true, route: true, objectType: true },
      })
    ).map((s) => [s.route, s]),
  );
  const missing = group.subs.filter((s) => !existingSubs.has(s.route));
  if (missing.length) {
    await prisma.subMenu.createMany({
      data: missing.map((s) => ({
        mainMenuId: main!.id,
        subMenuName: s.name,
        route: s.route,
        icon: s.icon,
        sortOrder: s.order,
        objectType: s.objectType ?? ObjectType.FORM,
      })),
    });
  }
  // Reconcile the kind of any existing sub-menu that was seeded before it was
  // tagged (e.g. an Inventory Report screen created as FORM). This is what makes
  // the Privileges matrix show Print/PDF/Excel for reports instead of Add/Edit.
  for (const s of group.subs) {
    const existing = existingSubs.get(s.route);
    const objectType = s.objectType ?? ObjectType.FORM;
    if (existing && existing.objectType !== objectType) {
      await prisma.subMenu.update({
        where: { id: existing.id },
        data: { objectType },
      });
    }
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
    // Super-admin-only screens (e.g. per-module Lookups) get a SubMenu + Object
    // Master entry so super admins can reach them, but the Administrators group
    // is NOT granted privileges — regular admins never see them.
    const superAdminRoutes = new Set(
      group.subs.filter((s) => s.superAdminOnly).map((s) => s.route),
    );
    const subs = await prisma.subMenu.findMany({
      where: { mainMenuId: main.id },
      select: { id: true, route: true },
    });
    await prisma.groupSubMenuPrivilege.createMany({
      data: subs
        .filter((sub) => !superAdminRoutes.has(sub.route ?? ''))
        .map((sub) => ({
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
