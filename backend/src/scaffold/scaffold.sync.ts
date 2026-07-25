import { ObjectType, Prisma } from '@prisma/client';
import { MODULE_SCAFFOLDS, type ModuleScaffold } from './module-scaffold';
import { CPANEL_COMPANY_SUBS } from '../modules/company/company-provisioning';
import { OPENING_STOCK_MENU } from '../modules/unit/inventory-provisioning';

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
  '/inventory/goods-return-note', // split into sales-return + purchase-return
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
 * One-time migration: the Cpanel module used to expose every screen under a
 * single "Cpanel" main menu. It is now split into two — "Admin Setup" (the
 * renamed primary) and "Company Setup" (the Cpanel screens listed in
 * CPANEL_COMPANY_SUBS). Per company: rename the legacy menu, create Company
 * Setup if missing, and move its screens across. Sub-menu ids don't change, so
 * their privileges follow automatically. Idempotent — a no-op once split.
 */
async function migrateCpanelMenuSplit(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  const cpanel = await prisma.module.findUnique({
    where: { code: 'CPANEL' },
    select: { id: true },
  });
  if (!cpanel) return; // fresh DB: nothing to migrate yet
  const cpanelId = cpanel.id;
  const companyRoutes = CPANEL_COMPANY_SUBS.map((s) => s.route);

  const menus = await prisma.mainMenu.findMany({
    where: { moduleId: cpanelId },
    select: { id: true, companyId: true, menuName: true, sortOrder: true },
    orderBy: { id: 'asc' },
  });
  const companyIds = [...new Set(menus.map((m) => m.companyId))];

  for (const companyId of companyIds) {
    const mine = menus.filter((m) => m.companyId === companyId);
    // The primary/admin menu is the oldest one that isn't the new Company Setup.
    const admin = mine.find((m) => m.menuName !== 'Company Setup');
    if (!admin) continue;

    // Rename the legacy "Cpanel" menu to "Admin Setup" (leave a custom rename be).
    if (admin.menuName === 'Cpanel') {
      await prisma.mainMenu.update({
        where: { id: admin.id },
        data: { menuName: 'Admin Setup', icon: 'settings' },
      });
    }

    // Ensure the Company Setup main menu exists.
    let companySetupId = mine.find((m) => m.menuName === 'Company Setup')?.id;
    if (!companySetupId) {
      const created = await prisma.mainMenu.create({
        data: {
          companyId,
          moduleId: cpanelId,
          menuName: 'Company Setup',
          sortOrder: (admin.sortOrder ?? 1) + 1,
          objectType: ObjectType.FORM,
          isUserMenu: true,
          icon: 'building',
        },
        select: { id: true },
      });
      companySetupId = created.id;
    }

    // Move the Company Setup screens off the admin menu (no-op once moved).
    await prisma.subMenu.updateMany({
      where: { mainMenuId: admin.id, route: { in: companyRoutes } },
      data: { mainMenuId: companySetupId },
    });
  }
}

/**
 * One-time migration: the Opening Stock entry screens used to sit under the
 * Inventory main menu. They now live in their own "Opening Stock" main menu.
 * Per company: create the menu, mirror the Inventory menu's group visibility so
 * every group that could reach these screens still can, and move the screens
 * across (sub-menu ids unchanged, so their privileges follow). Idempotent.
 */
async function migrateOpeningStockMenu(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  const inv = await prisma.module.findUnique({
    where: { code: 'INVENTORY' },
    select: { id: true },
  });
  if (!inv) return; // fresh DB: nothing to migrate yet
  const invId = inv.id;
  const osRoutes = OPENING_STOCK_MENU.subs.map((s) => s.route);

  const menus = await prisma.mainMenu.findMany({
    where: { moduleId: invId },
    select: { id: true, companyId: true, menuName: true, sortOrder: true },
    orderBy: { id: 'asc' },
  });
  const companyIds = [...new Set(menus.map((m) => m.companyId))];

  for (const companyId of companyIds) {
    const mine = menus.filter((m) => m.companyId === companyId);
    // The primary Inventory menu is the oldest one that isn't a known extra
    // menu (a renamed primary like "Inventory Master" still qualifies).
    const primary = mine.find(
      (m) =>
        m.menuName !== OPENING_STOCK_MENU.name &&
        m.menuName !== 'Inventory Report',
    );
    if (!primary) continue;

    // Keep Inventory Report at the bottom so the sidebar order is Inventory →
    // Opening Stock → Inventory Transactions (created by the sync at 3) →
    // Inventory Report. Avoids a sortOrder tie with the transactions menu.
    const report = mine.find((m) => m.menuName === 'Inventory Report');
    if (report && report.sortOrder < 4) {
      await prisma.mainMenu.update({
        where: { id: report.id },
        data: { sortOrder: 4 },
      });
    }

    // Ensure the Opening Stock main menu exists.
    let osId = mine.find((m) => m.menuName === OPENING_STOCK_MENU.name)?.id;
    if (!osId) {
      const created = await prisma.mainMenu.create({
        data: {
          companyId,
          moduleId: invId,
          menuName: OPENING_STOCK_MENU.name,
          sortOrder: 2,
          objectType: ObjectType.FORM,
          isUserMenu: true,
          icon: OPENING_STOCK_MENU.icon,
        },
        select: { id: true },
      });
      osId = created.id;
    }

    // Mirror the Inventory menu's group visibility onto Opening Stock so no
    // group loses reach (groups without OS sub-privileges just see it empty,
    // and the nav hides empty menus for non-super-admins).
    const invAccess = await prisma.groupMainMenuAccess.findMany({
      where: { mainMenuId: primary.id },
      select: { userGroupId: true, visible: true },
    });
    if (invAccess.length) {
      await prisma.groupMainMenuAccess.createMany({
        data: invAccess.map((a) => ({
          userGroupId: a.userGroupId,
          mainMenuId: osId!,
          visible: a.visible,
        })),
        skipDuplicates: true,
      });
    }

    // Move the Opening Stock screens off the Inventory menu (no-op once moved).
    await prisma.subMenu.updateMany({
      where: { mainMenuId: primary.id, route: { in: osRoutes } },
      data: { mainMenuId: osId },
    });
  }
}

/**
 * One-time rename: "Inventory Transactions" main menu → "Inventory Vouchers"
 * (the old label wrapped to two lines), and the Goods Issue Note screen loses
 * its "(Consumption)" suffix. Idempotent — no-op once renamed.
 */
async function migrateInventoryVoucherMenu(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  const inv = await prisma.module.findUnique({
    where: { code: 'INVENTORY' },
    select: { id: true },
  });
  if (!inv) return;

  await prisma.mainMenu.updateMany({
    where: { moduleId: inv.id, menuName: 'Inventory Transactions' },
    data: { menuName: 'Inventory Vouchers' },
  });
  await prisma.subMenu.updateMany({
    where: {
      route: '/inventory/goods-issue-note',
      subMenuName: 'Goods Issue Note (Consumption)',
    },
    data: { subMenuName: 'Goods Issue Note' },
  });
  await prisma.objectMaster.updateMany({
    where: {
      route: '/inventory/goods-issue-note',
      objectName: 'Goods Issue Note (Consumption)',
    },
    data: { objectName: 'Goods Issue Note', nameInMenu: 'Goods Issue Note' },
  });
}

/**
 * One-time rename: the two product screens are now named after the production
 * stage they hold rather than their packing state — "Products - Unpacked" →
 * "Products - Semifinished" and "Products - Packed" → "Products - Finished".
 * Routes (and therefore the rows themselves) are unchanged, so this is a pure
 * label update on the SubMenu + ObjectMaster entries; privileges and workflow
 * bindings hang off ids and are untouched. Guarded on the old name so an admin's
 * own rename is left alone. Idempotent — a no-op once renamed.
 */
async function migrateProductScreenNames(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  const RENAMES = [
    {
      route: '/inventory/products-unpacked',
      from: 'Products - Unpacked',
      to: 'Products - Semifinished',
    },
    {
      route: '/inventory/products-packed',
      from: 'Products - Packed',
      to: 'Products - Finished',
    },
  ];
  for (const { route, from, to } of RENAMES) {
    await prisma.subMenu.updateMany({
      where: { route, subMenuName: from },
      data: { subMenuName: to },
    });
    await prisma.objectMaster.updateMany({
      where: { route, objectName: from },
      data: { objectName: to, nameInMenu: to },
    });
  }
}

/**
 * Collapse duplicate rows for a screen, keeping the OLDEST — it's the original,
 * the one carrying privileges and workflow bindings; a twin is always the empty
 * newcomer.
 *
 * Duplicates arise whenever the additive sync creates a screen from the scaffold
 * BEFORE a migration renames the original onto that same route (nest --watch
 * re-runs the sync on every intermediate save, so this is routine in dev). They
 * are not cosmetic: PurchaseOrderService.docType resolves its screen with a
 * findFirst on the route, so a twin makes workflow matching a coin flip.
 *
 * Pass `repointToModuleId` for a screen that owns workflows: definitions match on
 * module AND object, so both are pulled onto the surviving row before the twins
 * are deleted. Deleting a SubMenu cascades its GroupSubMenuPrivilege rows.
 */
async function dedupeScreenRows(
  prisma: Prisma.TransactionClient,
  route: string,
  opts: { repointToModuleId?: number } = {},
): Promise<void> {
  const objects = await prisma.objectMaster.findMany({
    where: { route },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  const canonical = objects[0]?.id;
  if (canonical) {
    const ids = objects.map((o) => o.id);
    if (opts.repointToModuleId !== undefined) {
      const data = { objectId: canonical, moduleId: opts.repointToModuleId };
      await prisma.workflowDefinition.updateMany({
        where: { objectId: { in: ids } },
        data,
      });
      await prisma.workflowInstance.updateMany({
        where: { objectId: { in: ids } },
        data,
      });
    }
    if (ids.length > 1) {
      await prisma.objectMaster.deleteMany({
        where: { id: { in: ids.filter((id) => id !== canonical) } },
      });
    }
  }

  // One entry per menu (a screen legitimately appears once per company).
  const subs = await prisma.subMenu.findMany({
    where: { route },
    select: { id: true, mainMenuId: true },
    orderBy: { id: 'asc' },
  });
  const keptPerMenu = new Set<number>();
  const dropIds: number[] = [];
  for (const s of subs) {
    if (keptPerMenu.has(s.mainMenuId)) dropIds.push(s.id);
    else keptPerMenu.add(s.mainMenuId);
  }
  if (dropIds.length) {
    await prisma.subMenu.deleteMany({ where: { id: { in: dropIds } } });
  }
}

/**
 * One-time migration: the single CRM "Purchase Order - IC" screen became two —
 * "Purchase Order - Sent" (the buyer's view, which MOVES to the Purchase module)
 * and "Purchase Order - Received" (the supplier's view, which stays in CRM and
 * is created by the additive sync).
 *
 * The Sent screen inherits the original row, and everything here is an in-place
 * UPDATE rather than a delete + recreate via RETIRED_ROUTES, because ids are
 * load-bearing:
 *  - WorkflowDefinition.objectId / WorkflowInstance.objectId point at
 *    ObjectMaster.id, and WorkflowDefinition.moduleId at Module.id — all plain
 *    Ints with no FK (the cross-domain rule), so a delete would silently strand
 *    every configured PO workflow instead of failing loudly.
 *  - GroupSubMenuPrivilege hangs off SubMenu.id, so moving the row keeps the
 *    privileges already granted on it.
 * Because the screen changes module, the definitions' moduleId is re-pointed too
 * — otherwise they'd match on objectId but not module, and never fire.
 *
 * Idempotent — a no-op once migrated.
 */
async function migrateCrmPurchaseOrderRoutes(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  const [crm, purchase] = await Promise.all([
    prisma.module.findUnique({ where: { code: 'CRM' }, select: { id: true } }),
    prisma.module.findUnique({
      where: { code: 'PURCHASE' },
      select: { id: true },
    }),
  ]);
  // Fresh DB (or Purchase not registered yet): the additive sync seeds both
  // screens in their right modules directly, so there's nothing to move.
  if (!crm || !purchase) return;

  const SENT_ROUTE = '/purchase/icpo';
  const SENT_NAME = 'ICPO';
  // Every shape this screen has had. Listed so a DB pulled from any earlier
  // point lands here in one hop — the route is unique enough that the current
  // module doesn't need filtering (it has since moved to Purchase).
  const LEGACY_ROUTES = [
    '/crm/purchase-orders-ic',
    '/crm/purchase-orders-sent',
    '/purchase/purchase-orders-sent',
  ];

  // ---- the screen itself: rename + hand it to the Purchase module ----
  await prisma.objectMaster.updateMany({
    where: { route: { in: LEGACY_ROUTES } },
    data: {
      moduleId: purchase.id,
      route: SENT_ROUTE,
      objectName: SENT_NAME,
      nameInMenu: SENT_NAME,
    },
  });

  // ---- the supplier's side: rename in place, stays in CRM ----
  await prisma.objectMaster.updateMany({
    where: { route: '/crm/purchase-orders-received' },
    data: {
      route: '/crm/icpo-received',
      objectName: 'ICPO - Received',
      nameInMenu: 'ICPO - Received',
    },
  });
  await prisma.subMenu.updateMany({
    where: { route: '/crm/purchase-orders-received' },
    data: { route: '/crm/icpo-received', subMenuName: 'ICPO - Received' },
  });

  // ---- the Sales Orders placeholder becomes the ICSO screen ----
  // Renamed in place like everything else here, so the privileges already
  // granted on it follow. LSO joins it once the Customer master exists.
  await prisma.objectMaster.updateMany({
    where: { route: '/crm/sales-orders' },
    data: {
      route: '/crm/icso',
      objectName: 'ICSO',
      nameInMenu: 'ICSO',
    },
  });
  await prisma.subMenu.updateMany({
    where: { route: '/crm/sales-orders' },
    data: { route: '/crm/icso', subMenuName: 'ICSO' },
  });

  // ---- the Document Master entry (user-visible in Document Numbering) ----
  // Guarded on the old name so an admin's own rename is left alone. The CODE
  // stays PURCHASE_ORDER_IC: numbering rules key on documentId, but the seeder
  // upserts by code, so changing it would orphan the row and its rules.
  await prisma.document.updateMany({
    where: { code: 'PURCHASE_ORDER_IC', name: 'Purchase Order - IC' },
    data: { name: 'Inter-Company Purchase Order (ICPO)' },
  });

  // ---- the menu entry: move it from the CRM menu to the Purchase menu ----
  const crmMenus = await prisma.mainMenu.findMany({
    where: { moduleId: crm.id },
    select: { id: true, companyId: true },
    orderBy: { id: 'asc' },
  });
  for (const crmMenu of crmMenus) {
    const stale = await prisma.subMenu.findFirst({
      where: { mainMenuId: crmMenu.id, route: { in: LEGACY_ROUTES } },
      select: { id: true },
    });
    if (!stale) continue; // already moved for this company

    // Ensure this company has a Purchase main menu to move the screen onto.
    let purchaseMenu = await prisma.mainMenu.findFirst({
      where: { companyId: crmMenu.companyId, moduleId: purchase.id },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (!purchaseMenu) {
      purchaseMenu = await prisma.mainMenu.create({
        data: {
          companyId: crmMenu.companyId,
          moduleId: purchase.id,
          menuName: 'Purchase',
          sortOrder: 1,
          objectType: ObjectType.FORM,
          isUserMenu: true,
          icon: 'shopping-cart',
        },
        select: { id: true },
      });
    }

    // Mirror the CRM menu's group visibility onto Purchase so no group loses
    // reach (the nav hides empty menus for non-super-admins anyway).
    const crmAccess = await prisma.groupMainMenuAccess.findMany({
      where: { mainMenuId: crmMenu.id },
      select: { userGroupId: true, visible: true },
    });
    if (crmAccess.length) {
      await prisma.groupMainMenuAccess.createMany({
        data: crmAccess.map((a) => ({
          userGroupId: a.userGroupId,
          mainMenuId: purchaseMenu!.id,
          visible: a.visible,
        })),
        skipDuplicates: true,
      });
    }

    await prisma.subMenu.update({
      where: { id: stale.id },
      data: {
        mainMenuId: purchaseMenu.id,
        route: SENT_ROUTE,
        subMenuName: SENT_NAME,
        sortOrder: 1,
      },
    });
  }

  // Screens already moved to Purchase by an earlier run of this migration still
  // need the ICPO rename — the loop above only catches ones still sitting on a
  // CRM menu.
  await prisma.subMenu.updateMany({
    where: { route: { in: LEGACY_ROUTES } },
    data: { route: SENT_ROUTE, subMenuName: SENT_NAME, sortOrder: 1 },
  });

  // ---- collapse twins, and pull the workflows onto the survivor ----
  // Runs LAST on purpose: everything above can mint a row on these routes (the
  // renames, and the menu move), and dedupe must see the final set. It also runs
  // outside the move loop — once a company's screen has moved there's no stale
  // row left to key off, so a twin would otherwise survive forever.
  await dedupeScreenRows(prisma, SENT_ROUTE, { repointToModuleId: purchase.id });
  await dedupeScreenRows(prisma, '/crm/icpo-received');
  await dedupeScreenRows(prisma, '/crm/icso');

  // ---- keep everyone's reach ----
  // Module access is granted per group, and the screen just changed module: a
  // group that could open it under CRM (e.g. Branch Manager, who raises the
  // orders) would silently lose it, since the sync only ever grants a new module
  // to Administrators. Mirror CRM's grants onto Purchase so the move doesn't
  // change who can get in — the screen's own privileges still gate it, and
  // Purchase hosts nothing else, so this grants no extra reach.
  const crmGroups = await prisma.userGroupModule.findMany({
    where: { moduleId: crm.id },
    select: { userGroupId: true },
  });
  if (crmGroups.length) {
    await prisma.userGroupModule.createMany({
      data: crmGroups.map((g) => ({
        userGroupId: g.userGroupId,
        moduleId: purchase.id,
      })),
      skipDuplicates: true,
    });
  }

  // With the buyer's screen gone to Purchase, CRM leads with ICPO - Received (1)
  // then ICSO (2). The additive sync only sets sortOrder on create — and Received
  // was seeded at 2 back when Sent held 1 — so pin both or they tie and order
  // arbitrarily.
  await prisma.subMenu.updateMany({
    where: { route: '/crm/icpo-received' },
    data: { sortOrder: 1 },
  });
  await prisma.subMenu.updateMany({
    where: { route: '/crm/icso' },
    data: { sortOrder: 2 },
  });
}

/** Rename the Accounts module's primary main menu "Accounts" → "Accounts Setup". */
async function migrateAccountsMenuName(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  const acc = await prisma.module.findUnique({
    where: { code: 'ACCOUNTS' },
    select: { id: true },
  });
  if (!acc) return;
  await prisma.mainMenu.updateMany({
    where: { moduleId: acc.id, menuName: 'Accounts' },
    data: { menuName: 'Accounts Setup' },
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

  // 0b) Split the legacy single "Cpanel" menu into "Admin Setup" + "Company
  //     Setup". Must run before the additive sync so it reuses the moved subs
  //     instead of creating duplicates under the new menu.
  await migrateCpanelMenuSplit(prisma);

  // 0c) Move the Opening Stock screens out of the Inventory menu into their own
  //     "Opening Stock" main menu. Same ordering constraint as above.
  await migrateOpeningStockMenu(prisma);

  // 0d) Rename the Inventory Transactions menu → Inventory Vouchers (fits on one
  //     line) and drop the "(Consumption)" suffix from Goods Issue Note. Must run
  //     before the sync so the extra menu is matched by its new name.
  await migrateInventoryVoucherMenu(prisma);

  // 0e) Rename the Accounts module's main menu → "Accounts Setup".
  await migrateAccountsMenuName(prisma);

  // 0e2) Rename the product screens → Products - Semifinished / - Finished.
  await migrateProductScreenNames(prisma);

  // 0f) Split Purchase Order - IC in two: Sent moves to the Purchase module,
  //     Received stays in CRM. Must run before the sync so the moved screen is
  //     matched by its new route/module and the sync adds Received alongside it
  //     rather than duplicating either.
  await migrateCrmPurchaseOrderRoutes(prisma);

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
