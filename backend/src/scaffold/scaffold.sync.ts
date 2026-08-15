import { ObjectType, Prisma, WidgetType } from '@prisma/client';
import { MODULE_SCAFFOLDS, type ModuleScaffold } from './module-scaffold';
import { CPANEL_COMPANY_SUBS } from '../modules/company/company-provisioning';
import {
  OPENING_STOCK_MENU,
  PRODUCTION_COSTING_MENU,
  PRODUCTION_REPORT_MENUS,
} from '../modules/unit/inventory-provisioning';
import { ACCOUNTS_REPORT_MENUS } from '../modules/supplier/accounts-provisioning';

/**
 * The group every new screen is granted to, and the one this sync will not take
 * anything away from. Matched by NAME — plural, exactly so — because that is how
 * company provisioning creates it and how the rest of the scaffold finds it.
 */
const ADMIN_GROUP_NAME = 'Administrators';

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
  '/production/divisions', // dropped — cost centres/objects track production instead
  '/accounts/vouchers', // split into one screen per voucher kind (cash-receipt, …)
  '/accounts/pdc-register', // split into pdc-issued + pdc-received
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
 * One-time migration: Price Review and Cost Review were first shipped under the
 * operational "Production" main menu. They now live in their own "Costing
 * Review" menu — different work: the Production screens are what you DO on a
 * given day, these are a periodic check that costs and margins still hold.
 *
 * Per company: create the menu, mirror the Production menu's group visibility so
 * no group loses reach, and move the screens across. The sub-menu ids are
 * unchanged, so the privileges already granted on them follow. Idempotent — a
 * no-op once moved, and on a fresh DB where the sync creates them in place.
 */
async function migrateProductionCostingMenu(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  const prod = await prisma.module.findUnique({
    where: { code: 'PRODUCTION' },
    select: { id: true },
  });
  if (!prod) return; // fresh DB: nothing to migrate yet
  const routes = PRODUCTION_COSTING_MENU.subs.map((s) => s.route);

  const menus = await prisma.mainMenu.findMany({
    where: { moduleId: prod.id },
    select: { id: true, companyId: true, menuName: true, sortOrder: true },
    orderBy: { id: 'asc' },
  });
  const companyIds = [...new Set(menus.map((m) => m.companyId))];

  for (const companyId of companyIds) {
    const mine = menus.filter((m) => m.companyId === companyId);
    // The primary Production menu is the oldest that is not a known extra menu
    // (a renamed primary still qualifies).
    const primary = mine.find(
      (m) =>
        m.menuName !== PRODUCTION_COSTING_MENU.name &&
        !PRODUCTION_REPORT_MENUS.some((r) => r.name === m.menuName),
    );
    if (!primary) continue;

    // Push Production Report down so the sidebar reads Production → Costing
    // Review → Production Report, rather than tying at 2.
    const report = mine.find((m) =>
      PRODUCTION_REPORT_MENUS.some((r) => r.name === m.menuName),
    );
    if (report && report.sortOrder < 3) {
      await prisma.mainMenu.update({
        where: { id: report.id },
        data: { sortOrder: 3 },
      });
    }

    let costingId = mine.find(
      (m) => m.menuName === PRODUCTION_COSTING_MENU.name,
    )?.id;
    if (!costingId) {
      const created = await prisma.mainMenu.create({
        data: {
          companyId,
          moduleId: prod.id,
          menuName: PRODUCTION_COSTING_MENU.name,
          // After Production, before Production Report.
          sortOrder: 2,
          objectType: ObjectType.FORM,
          isUserMenu: true,
          icon: PRODUCTION_COSTING_MENU.icon,
        },
        select: { id: true },
      });
      costingId = created.id;
    }

    // Mirror the Production menu's group visibility, so a group that could
    // reach these screens still can. Groups without sub-privileges just see it
    // empty, and the nav hides empty menus for non-super-admins.
    const access = await prisma.groupMainMenuAccess.findMany({
      where: { mainMenuId: primary.id },
      select: { userGroupId: true, visible: true },
    });
    if (access.length) {
      await prisma.groupMainMenuAccess.createMany({
        data: access.map((a) => ({
          userGroupId: a.userGroupId,
          mainMenuId: costingId!,
          visible: a.visible,
        })),
        skipDuplicates: true,
      });
    }

    await prisma.subMenu.updateMany({
      where: { mainMenuId: primary.id, route: { in: routes } },
      data: { mainMenuId: costingId },
    });

    // The additive sync never renumbers an existing screen, so a moved one
    // would keep the order it had in the Production menu (10, 11) instead of
    // this menu's own 1, 2. Harmless to relative order, but it leaves the DB
    // disagreeing with the scaffold — so set it here rather than by hand.
    for (const sub of PRODUCTION_COSTING_MENU.subs) {
      await prisma.subMenu.updateMany({
        where: { mainMenuId: costingId, route: sub.route },
        data: { sortOrder: sub.order },
      });
    }
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
  await dedupeScreenRows(prisma, SENT_ROUTE, {
    repointToModuleId: purchase.id,
  });
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

/**
 * One-time migration: the Chart of Accounts was first shipped as a maintenance
 * screen under "Accounts Setup". It is now a REPORT — the master read the way a
 * statement is, groups over sub-groups over ledgers — and maintenance has moved
 * to the Account Groups and Account Ledgers screens the sync creates alongside.
 *
 * The screen keeps its route, so this moves the row rather than replacing it:
 * SubMenu.id is what GroupSubMenuPrivilege hangs off, and a delete-and-recreate
 * would drop every privilege already granted on it. The sync reconciles its
 * FORM → REPORT kind afterwards, which is what makes the Privileges matrix show
 * Print / PDF / Excel instead of Add / Edit. Idempotent — a no-op once moved,
 * and on a fresh DB where the sync creates it in place.
 */
/**
 * Rename two of the Accounts main menus in place.
 *
 * An EXTRA menu is matched by name, so a rename in the registry alone would
 * create a second menu beside the first and leave every screen — and every
 * privilege granted on it — under the old one. Renaming the row is what makes
 * the sync find it again.
 *
 * Idempotent: a no-op once renamed, and on a fresh database where the sync
 * creates them under the new names.
 */
async function migrateAccountsMenuNames(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  const acc = await prisma.module.findUnique({
    where: { code: 'ACCOUNTS' },
    select: { id: true },
  });
  if (!acc) return;
  for (const [from, to] of [
    ['Accounts Vouchers', 'Accounting Vouchers'],
    ['Accounts Report', 'Accounts Reports'],
  ] as const) {
    await prisma.mainMenu.updateMany({
      where: { moduleId: acc.id, menuName: from },
      data: { menuName: to },
    });
  }

  // A boot that ran the registry's new name before this rename existed created
  // an empty menu beside the real one. Fold those away: same name, no screens,
  // and another by that name holding them.
  const menus = await prisma.mainMenu.findMany({
    where: { moduleId: acc.id },
    select: {
      id: true,
      companyId: true,
      menuName: true,
      _count: { select: { subMenus: true } },
    },
  });
  const empties = menus.filter(
    (m) =>
      m._count.subMenus === 0 &&
      menus.some(
        (o) =>
          o.companyId === m.companyId &&
          o.menuName === m.menuName &&
          o._count.subMenus > 0,
      ),
  );
  if (empties.length) {
    await prisma.mainMenu.deleteMany({
      where: { id: { in: empties.map((m) => m.id) } },
    });
  }

  // The order the module is read in: enter, check, read, agree. Only the
  // creating sync sets sortOrder, so a menu added later — or renamed into a
  // different position — keeps whatever it was given the day it appeared.
  const ORDER = [
    'Accounts Setup',
    'Accounting Vouchers',
    'Accounts Reports',
    'Financial Statement',
    'Bank Reports',
  ];
  for (const [i, menuName] of ORDER.entries()) {
    await prisma.mainMenu.updateMany({
      where: { moduleId: acc.id, menuName },
      data: { sortOrder: i + 1 },
    });
  }
}

async function migrateAccountsReportMenu(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  const acc = await prisma.module.findUnique({
    where: { code: 'ACCOUNTS' },
    select: { id: true },
  });
  if (!acc) return; // fresh DB: nothing to move
  const report = ACCOUNTS_REPORT_MENUS[0];
  const routes = report.subs.map((s) => s.route);

  const menus = await prisma.mainMenu.findMany({
    where: { moduleId: acc.id },
    select: { id: true, companyId: true, menuName: true },
    orderBy: { id: 'asc' },
  });
  const companyIds = [...new Set(menus.map((m) => m.companyId))];

  for (const companyId of companyIds) {
    const mine = menus.filter((m) => m.companyId === companyId);
    // The primary menu is the oldest that is not the report menu (a renamed
    // primary still qualifies).
    const primary = mine.find((m) => m.menuName !== report.name);
    if (!primary) continue;

    let reportId = mine.find((m) => m.menuName === report.name)?.id;
    if (!reportId) {
      const created = await prisma.mainMenu.create({
        data: {
          companyId,
          moduleId: acc.id,
          menuName: report.name,
          sortOrder: 2, // after Accounts Setup
          objectType: ObjectType.FORM,
          isUserMenu: true,
          icon: report.icon,
        },
        select: { id: true },
      });
      reportId = created.id;
    }

    // Mirror the setup menu's group visibility so no group loses reach. Groups
    // without privileges on the screen just see the menu empty, and the nav
    // hides empty menus for non-super-admins.
    const access = await prisma.groupMainMenuAccess.findMany({
      where: { mainMenuId: primary.id },
      select: { userGroupId: true, visible: true },
    });
    if (access.length) {
      await prisma.groupMainMenuAccess.createMany({
        data: access.map((a) => ({
          userGroupId: a.userGroupId,
          mainMenuId: reportId!,
          visible: a.visible,
        })),
        skipDuplicates: true,
      });
    }

    await prisma.subMenu.updateMany({
      where: { mainMenuId: primary.id, route: { in: routes } },
      data: { mainMenuId: reportId },
    });

    // The additive sync never renumbers an existing screen, so the moved one
    // would keep the order it had in the setup menu instead of this menu's own.
    for (const sub of report.subs) {
      await prisma.subMenu.updateMany({
        where: { mainMenuId: reportId, route: sub.route },
        data: { sortOrder: sub.order },
      });
    }
  }

  // A twin can only exist if an earlier boot created the report screen under
  // the new menu before this migration moved the original across.
  for (const route of routes) await dedupeScreenRows(prisma, route);
}

/**
 * One-time rename: the Workflow module is now "Workplace" — it grows from the
 * approver inbox into everything addressed to a person rather than owned by a
 * business domain (internal mail, chat, circulars, tasks; SRS §8.11 + §8.12).
 *
 * The module row itself needs nothing: the sync's upsert keys on `code` (still
 * WORKFLOW) and rewrites name/icon on every boot. The main menu does — it is
 * matched by moduleId, so the sync happily reuses an existing row and never
 * renames it, leaving every existing database still saying "Workflow" in the
 * sidebar. Renaming the row in place keeps its id, so the group visibility and
 * the privileges granted on its screens all follow.
 *
 * Guarded on the old name so an admin's own rename is left alone. Idempotent —
 * a no-op once renamed, and on a fresh DB where the sync creates it as
 * Workplace to begin with.
 */
/**
 * The HR module's menus, relabelled: the primary went "Human Resources" → "HR
 * Master" → "HR Setup", and the two extras "HR Data" → "HR Records" and
 * "HR Reports" → "HR Analysis".
 *
 * The extra one matters MORE than the primary, not less. A primary menu is
 * matched by moduleId, so a declaration renamed without this would merely show
 * the old label. An extra is matched by NAME — the sync would find nothing
 * called "HR Records", build a second menu, and leave the old one standing with
 * Employee Master and every privilege on it underneath.
 *
 * Needed because the sync matches a PRIMARY menu by moduleId and never renames
 * it — so without this, an existing database would keep the old label while a
 * fresh one got the new. The screens under it move nowhere: they stay on the
 * same MainMenu row, which is the point of relabelling rather than replacing —
 * GroupSubMenuPrivilege hangs off SubMenu.id.
 *
 * Every superseded name is listed, so a database that skipped a release lands on
 * the current one in a single step rather than needing them applied in order.
 * Guarded on those names alone, so an admin's own rename is left alone.
 *
 * The re-ordering is a `runOnce` rather than part of the additive sync, which
 * only sets sortOrder on CREATE: Lookups goes to the top of the master menu, and
 * an admin who rearranges it afterwards keeps their arrangement.
 */
const HR_MENU_RENAMES: { from: string[]; to: string }[] = [
  { from: ['Human Resources', 'HR Master'], to: 'HR Setup' },
  { from: ['HR Data'], to: 'HR Records' },
  { from: ['HR Reports'], to: 'HR Analysis' },
];

async function migrateHrMenus(prisma: Prisma.TransactionClient): Promise<void> {
  const hr = await prisma.module.findUnique({
    where: { code: 'HR' },
    select: { id: true },
  });
  if (!hr) return; // fresh DB: the sync creates them with the new names

  for (const { from, to } of HR_MENU_RENAMES) {
    await prisma.mainMenu.updateMany({
      where: { moduleId: hr.id, menuName: { in: from } },
      data: { menuName: to },
    });
  }

  await runOnce(prisma, 'hr-master-menu-order', async () => {
    const order: Record<string, number> = {
      '/hr/lookups': 1,
      '/hr/categories': 2,
      '/hr/groups': 3,
      '/hr/designations': 4,
    };
    for (const [route, sortOrder] of Object.entries(order)) {
      await prisma.subMenu.updateMany({
        where: { route },
        data: { sortOrder },
      });
    }
  });

  /**
   * Drop the HR `DEPARTMENT` lookup.
   *
   * The Employee Master briefly took its department from a lookup of its own.
   * It now takes DIVISION and DEPARTMENT from the company master — a division is
   * a cost centre, a department the cost object under it — because the company
   * already carries that structure and the ledger already posts against it.
   * Naming departments twice would have meant an employee filed under one
   * "Packing" and their cost posted to another.
   *
   * Safe to delete rather than leave lying about: the lookup shipped and was
   * withdrawn the same day, nothing ever referenced its values, and a stray list
   * in HR → Lookups that no screen reads is a question somebody has to answer
   * later. Values go with it (Cascade on LookupValue.lookupId).
   */
  await runOnce(prisma, 'hr-department-lookup-dropped', async () => {
    await prisma.lookup.deleteMany({ where: { code: 'DEPARTMENT' } });
  });

  await seedEmployeeNumbering(prisma);
}

/**
 * Give every company a numbering rule for employee codes.
 *
 * The Employee Master used to mint EMP-0001 itself. It now draws from the
 * central numbering (Cpanel → Document Numbering, document EMPLOYEE) like every
 * other number in the system, and this puts a real rule row in front of each
 * company so the screen shows something to edit rather than a set of defaults
 * nobody has agreed to. The shape seeded is exactly what the hard-coded one
 * produced — EMP-0001 — so nothing about existing codes changes; what changes is
 * that HR can now make it EKF/EMP/0001 per company without a developer.
 *
 * Skipped WITHOUT marking itself done while the EMPLOYEE document row is
 * missing: the document master is seeded by DocumentService on the same
 * bootstrap and the two are not ordered against each other, so a first boot that
 * loses the race simply seeds on the next one.
 *
 * runOnce, not an upsert every boot: a company that deletes its rule means "use
 * the defaults", and re-creating it each morning would be arguing with them.
 */
async function seedEmployeeNumbering(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  const doc = await prisma.document.findUnique({
    where: { code: 'EMPLOYEE' },
    select: { id: true },
  });
  if (!doc) return;

  await runOnce(prisma, 'employee-numbering-rules', async () => {
    const companies = await prisma.company.findMany({ select: { id: true } });
    for (const c of companies) {
      await prisma.documentNumberingRule.upsert({
        where: {
          companyId_documentId: { companyId: c.id, documentId: doc.id },
        },
        create: {
          companyId: c.id,
          documentId: doc.id,
          prefixEnabled: true,
          prefixValue: 'EMP-',
          // No branch code. An employee code follows the person, not the
          // branch they were hired at — KDY/EMP-0001 becomes a lie the day
          // they transfer to Kothamangalam.
          branchPrefix: false,
          startingNo: 1,
          paddingLength: 4,
          // NEVER: an employee code is issued once and quoted for years. A
          // series that restarted every year would hand one person's number to
          // somebody else.
          renumber: 'NEVER',
        },
        update: {},
      });
    }
  });

  // The rules above shipped before the branch-code switch existed, so the ones
  // already in a database carry its default (on) and read KDY/EMP-0001. Turned
  // off once, for the same reason it is seeded off.
  await runOnce(prisma, 'employee-numbering-no-branch-code', async () => {
    await prisma.documentNumberingRule.updateMany({
      where: { documentId: doc.id },
      data: { branchPrefix: false },
    });
  });
}

async function migrateWorkflowMenuName(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  const wf = await prisma.module.findUnique({
    where: { code: 'WORKFLOW' },
    select: { id: true },
  });
  if (!wf) return; // fresh DB: nothing to rename yet
  await prisma.mainMenu.updateMany({
    where: { moduleId: wf.id, menuName: 'Workflow' },
    data: { menuName: 'Workplace', icon: 'briefcase' },
  });
}

/**
 * One-time migration: the Workplace module's single menu becomes five —
 * Documents, Communication, Tasks, Circulars and Broadcast — grouped by the KIND
 * of thing waiting for a person rather than by the subsystem that serves it.
 *
 * Two screens already exist and MOVE rather than being replaced, because their
 * ids are load-bearing: GroupSubMenuPrivilege hangs off SubMenu.id, and
 * WorkflowDefinition/WorkflowInstance point at ObjectMaster.id as plain Ints
 * with no FK (the cross-domain rule), so a delete-and-recreate would strand both
 * silently rather than failing loudly.
 *
 *  - "My Approvals" is relabelled "For Approval" and stays on the primary menu,
 *    which is itself relabelled "Workplace" → "Documents". Its ROUTE is
 *    deliberately untouched: the Topbar's notification bell links to it, and a
 *    tidier path is not worth re-pointing privileges for.
 *  - "Chat" moves onto the new Communication menu.
 *
 * Must run BEFORE the additive sync, so the sync finds both screens under their
 * new menus and adds the unbuilt ones alongside instead of duplicating either.
 * Guarded on the old names so an admin's own rename is left alone; idempotent —
 * a no-op once migrated, and on a fresh DB where the sync builds this directly.
 */
async function migrateWorkplaceMenus(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  const wf = await prisma.module.findUnique({
    where: { code: 'WORKFLOW' },
    select: { id: true },
  });
  if (!wf) return; // fresh DB: the sync creates all five menus directly

  // ---- the approval inbox is relabelled, in place ----
  await prisma.subMenu.updateMany({
    where: { route: '/workflow/approvals', subMenuName: 'My Approvals' },
    data: { subMenuName: 'For Approval', sortOrder: 1 },
  });
  await prisma.objectMaster.updateMany({
    where: { route: '/workflow/approvals', objectName: 'My Approvals' },
    data: { objectName: 'For Approval', nameInMenu: 'For Approval' },
  });

  const menus = await prisma.mainMenu.findMany({
    where: { moduleId: wf.id },
    select: { id: true, companyId: true, menuName: true },
    orderBy: { id: 'asc' },
  });
  const companyIds = [...new Set(menus.map((m) => m.companyId))];

  for (const companyId of companyIds) {
    const mine = menus.filter((m) => m.companyId === companyId);
    // The primary is the oldest menu that is not one of the new extras (a menu
    // an admin renamed themselves still qualifies).
    const extraNames = new Set([
      'Communication',
      'Tasks',
      'Circulars',
      'Broadcast',
    ]);
    const primary = mine.find((m) => !extraNames.has(m.menuName));
    if (!primary) continue;

    // ---- the primary menu becomes Documents ----
    if (primary.menuName === 'Workplace' || primary.menuName === 'Workflow') {
      await prisma.mainMenu.update({
        where: { id: primary.id },
        data: { menuName: 'Documents', icon: 'file-text' },
      });
    }

    // ---- Chat moves to its own Communication menu ----
    const chat = await prisma.subMenu.findFirst({
      where: { mainMenuId: primary.id, route: '/workplace/chat' },
      select: { id: true },
    });
    if (!chat) continue; // already moved for this company

    let communicationId = mine.find((m) => m.menuName === 'Communication')?.id;
    if (!communicationId) {
      const created = await prisma.mainMenu.create({
        data: {
          companyId,
          moduleId: wf.id,
          menuName: 'Communication',
          sortOrder: 2, // after Documents
          objectType: ObjectType.FORM,
          isUserMenu: true,
          icon: 'mail',
        },
        select: { id: true },
      });
      communicationId = created.id;
    }

    // Mirror the primary's group visibility so a group that could reach Chat
    // still can — the sync only ever grants a NEW menu to Administrators, so
    // without this every other group would silently lose it. Groups with no
    // privilege on the screens just see the menu empty, and the nav hides an
    // empty menu for non-super-admins.
    const access = await prisma.groupMainMenuAccess.findMany({
      where: { mainMenuId: primary.id },
      select: { userGroupId: true, visible: true },
    });
    if (access.length) {
      await prisma.groupMainMenuAccess.createMany({
        data: access.map((a) => ({
          userGroupId: a.userGroupId,
          mainMenuId: communicationId!,
          visible: a.visible,
        })),
        skipDuplicates: true,
      });
    }

    await prisma.subMenu.update({
      where: { id: chat.id },
      data: { mainMenuId: communicationId, sortOrder: 4 },
    });
  }

  // A twin can only exist if an earlier boot created a screen under its new
  // menu before this migration moved the original across.
  await dedupeScreenRows(prisma, '/workflow/approvals', {
    repointToModuleId: wf.id,
  });
  await dedupeScreenRows(prisma, '/workplace/chat');
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

  // 0e) Rename the Accounts module's main menu → "Accounts Setup", then move
  //     the Chart of Accounts out of it into "Accounts Report" (it is a report
  //     now; Groups and Ledgers do the maintenance). Before the additive sync so
  //     the moved screen is matched under its new menu rather than duplicated.
  await migrateAccountsMenuName(prisma);
  await migrateAccountsReportMenu(prisma);
  await migrateAccountsMenuNames(prisma);

  // 0e2) Rename the product screens → Products - Semifinished / - Finished.
  await migrateProductScreenNames(prisma);

  // 0e2b) Rename the Workflow module's main menu → "Workplace", then split that
  //       one menu into the five the module now has. Both before the additive
  //       sync, so the renamed/moved rows are the ones it reuses. Ordered:
  //       the split expects to find the menu under its post-rename name.
  await migrateHrMenus(prisma);
  await migrateWorkflowMenuName(prisma);
  await migrateWorkplaceMenus(prisma);

  // 0e3) Move Price Review + Cost Review off the operational Production menu
  //      into their own "Costing Review" menu. Before the additive sync so the
  //      moved screens are matched under the new menu rather than duplicated.
  await migrateProductionCostingMenu(prisma);

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

  // 3) Workplace belongs to everyone. Runs LAST: it hands out the module row,
  //    the per-company menus and the screens the steps above have just created.
  await grantWorkplaceToEveryone(prisma);
  await orderWorkplaceMenus(prisma);

  // 4) After the menus, because it hides one of the tabs they just created.
  await hideUserAccessTabByDefault(prisma);

  // 5) And the HR Dashboard's starting widgets, which need the module row
  //    above and a dashboard to hang on.
  await seedHrDashboardWidgets(prisma);
  await addHrStatusWidgets(prisma);
}

/**
 * Shut every hidden-by-default tab — User Access today — to the groups that
 * existed before the idea did.
 *
 * A tab nobody has hidden is VISIBLE (see GroupSubMenuTabAccess), which is right
 * for tabs in general and too generous for a few: User Access is where logins
 * are created and roles handed out, and leaving it on by default would give it
 * to whoever already maintains staff records — including, in the end, the means
 * to widen their own access.
 *
 * This is the back-fill for databases that already had the tabs. From here on
 * the two live paths keep it true without it:
 *   · a NEW tab → closed to existing groups as it is created (syncSubMenuTabs)
 *   · a NEW group → closed to every such tab as it is created (UserGroupService)
 *
 * `runOnce`, emphatically. Every boot would be arguing with the admin who ticked
 * it back on that morning — this is a starting position, not a rule.
 */
async function hideUserAccessTabByDefault(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  await runOnce(prisma, 'hide-user-access-tab-by-default', async () => {
    const tabs = await prisma.subMenuTab.findMany({
      where: { hiddenByDefault: true },
      select: {
        id: true,
        subMenu: { select: { mainMenu: { select: { companyId: true } } } },
      },
    });
    if (!tabs.length) return;

    // Grouped by company: a group and the tab it is being refused belong to one
    // company, and joining without that would write a setting against a screen
    // the group never sees.
    const byCompany = new Map<number, number[]>();
    for (const t of tabs) {
      const companyId = t.subMenu.mainMenu.companyId;
      byCompany.set(companyId, [...(byCompany.get(companyId) ?? []), t.id]);
    }

    for (const [companyId, tabIds] of byCompany) {
      const groups = await prisma.userGroup.findMany({
        where: { companyId, name: { not: ADMIN_GROUP_NAME } },
        select: { id: true },
      });
      if (!groups.length) continue;
      // createMany + skipDuplicates rather than an upsert: a group that already
      // has a row has been decided about, and this is only a default.
      await prisma.groupSubMenuTabAccess.createMany({
        data: groups.flatMap((g) =>
          tabIds.map((subMenuTabId) => ({
            userGroupId: g.id,
            subMenuTabId,
            visible: false,
          })),
        ),
        skipDuplicates: true,
      });
    }
  });
}

/**
 * Put My Day at the top of the Workplace module.
 *
 * It has to run here rather than with the other migrations, because those go
 * BEFORE the menu sync and this one reorders menus the sync has just created.
 *
 * Why it matters beyond tidiness: Workplace is the module every login lands on,
 * and the landing route is the first screen of the first menu (see
 * moduleLandingRoute on the front end). So this ordering is what decides that
 * signing in opens the dashboard rather than the approvals inbox.
 *
 * Once, like every other ordering step — an admin who rearranges the menu
 * afterwards keeps their arrangement.
 */
async function orderWorkplaceMenus(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  const workplace = await prisma.module.findUnique({
    where: { code: 'WORKFLOW' },
    select: { id: true },
  });
  if (!workplace) return;

  await runOnce(prisma, 'workplace-dashboard-first', async () => {
    // Read in the order a working day is: what is going on, then what has to be
    // decided, then what has been said, then what has to be done.
    const ORDER = [
      'My Day',
      'Documents',
      'Communication',
      'Tasks',
      'Circulars',
      'Broadcast',
    ];
    for (const [i, menuName] of ORDER.entries()) {
      await prisma.mainMenu.updateMany({
        where: { moduleId: workplace.id, menuName },
        data: { sortOrder: i + 1 },
      });
    }
  });
}

/**
 * Give every user group, and every user, the Workplace module — and make it the
 * module a login lands on.
 *
 * Workplace carries what is addressed to a PERSON rather than owned by a
 * business domain: the approval inbox, internal mail, chat, tasks (SRS §8.11 +
 * §8.12). Unlike a domain module there is no role that should be without it, so
 * granting it is not a decision the sync should wait on an admin to make — the
 * way it waits for Inventory or Accounts.
 *
 * The grants are asserted on every boot, the same way `autoEnable` re-enables
 * the module for every company above — and additively, so they undo nothing: a
 * grant uses skipDuplicates, and the Privileges screen upserts (it clears a
 * row's flags rather than deleting the row), so a privilege since switched off
 * stays off.
 *
 * The landing module is different: which module a login opens on is a per-user
 * setting the User form exists to edit, so it is switched over ONCE (recorded in
 * ScaffoldMigration) rather than re-asserted every boot. Users created later
 * start on Workplace via UserService, which defaults them to it.
 */
async function grantWorkplaceToEveryone(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  // Code stays WORKFLOW; only the label is Workplace (see module-scaffold).
  const workplace = await prisma.module.findUnique({
    where: { code: 'WORKFLOW' },
    select: { id: true },
  });
  if (!workplace) return;
  const moduleId = workplace.id;

  const groups = await prisma.userGroup.findMany({
    select: { id: true, companyId: true },
  });

  // ---- every user group manages the module ----
  if (groups.length) {
    await prisma.userGroupModule.createMany({
      data: groups.map((g) => ({ userGroupId: g.id, moduleId })),
      skipDuplicates: true,
    });
  }

  // ---- ...and sees every screen in it ----
  // Module access alone only puts Workplace in the module switcher: navigation
  // is driven purely by the group's menu rows, so without these the group would
  // land on an empty sidebar. Super-admin-only screens (the per-module Lookups)
  // are skipped, exactly as in the Administrators grant.
  const scaffold = MODULE_SCAFFOLDS.find((m) => m.code === 'WORKFLOW');
  const superAdminRoutes = new Set(
    [
      ...(scaffold?.subs ?? []),
      ...(scaffold?.extraMenus ?? []).flatMap((e) => e.subs),
    ]
      .filter((s) => s.superAdminOnly)
      .map((s) => s.route),
  );
  const menus = await prisma.mainMenu.findMany({
    where: { moduleId },
    select: {
      id: true,
      companyId: true,
      subMenus: { select: { id: true, route: true } },
    },
  });
  const menuAccess: {
    userGroupId: number;
    mainMenuId: number;
    visible: boolean;
  }[] = [];
  const subPrivileges: Prisma.GroupSubMenuPrivilegeCreateManyInput[] = [];
  for (const menu of menus) {
    for (const g of groups) {
      if (g.companyId !== menu.companyId) continue;
      menuAccess.push({
        userGroupId: g.id,
        mainMenuId: menu.id,
        visible: true,
      });
      for (const sub of menu.subMenus) {
        if (superAdminRoutes.has(sub.route ?? '')) continue;
        subPrivileges.push({
          userGroupId: g.id,
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
        });
      }
    }
  }
  if (menuAccess.length) {
    await prisma.groupMainMenuAccess.createMany({
      data: menuAccess,
      skipDuplicates: true,
    });
  }
  if (subPrivileges.length) {
    await prisma.groupSubMenuPrivilege.createMany({
      data: subPrivileges,
      skipDuplicates: true,
    });
  }

  // ---- every user, wherever their access is pinned to a module list ----
  // A UserModule row NARROWS what a user sees: with none, they get every module
  // their groups grant (Workplace included, from above); with any, only the
  // ones listed. So a row is added only where the user already has one for that
  // company — handing a row to a user who has none would cut them down to
  // Workplace alone, which is the opposite of granting it.
  const pinned = await prisma.userModule.findMany({
    select: { userId: true, companyId: true },
    distinct: ['userId', 'companyId'],
  });
  if (pinned.length) {
    await prisma.userModule.createMany({
      data: pinned.map((p) => ({
        userId: p.userId,
        companyId: p.companyId,
        moduleId,
      })),
      skipDuplicates: true,
    });
  }

  // ---- ...and lands there after login ----
  // Both levels, because buildProfile reads the per-company default first and
  // only falls back to the user's global one. Once, so that a landing module
  // chosen afterwards in the User form survives the next restart.
  await runOnce(prisma, 'workplace-is-the-default-module', async () => {
    await prisma.user.updateMany({ data: { defaultModuleId: moduleId } });
    await prisma.userCompany.updateMany({
      data: { defaultModuleId: moduleId },
    });
  });

  // ---- Drafts goes between Inbox and Sent ----
  // The sync only ever ADDS menus, so Drafts arrived after Chat and shared its
  // sort order, leaving the Communication menu reading New Mail, Inbox, Sent,
  // Chat, Drafts. Reordering existing rows is exactly what runOnce is for: the
  // registry's order is applied to what is already there, once, so that an
  // admin who rearranges the menu afterwards keeps their arrangement.
  await runOnce(prisma, 'workplace-mail-drafts-above-sent', async () => {
    const order: Record<string, number> = {
      '/workplace/mail/new': 1,
      '/workplace/mail/inbox': 2,
      '/workplace/mail/drafts': 3,
      '/workplace/mail/sent': 4,
      '/workplace/chat': 5,
    };
    for (const [route, sortOrder] of Object.entries(order)) {
      await prisma.subMenu.updateMany({
        where: { route },
        data: { sortOrder },
      });
    }
  });

  // ---- approvals already waiting keep their place on the bell ----
  // The approval engine's own notification table is gone: an approval alert is
  // now an ordinary Notification raised through the NOTIFICATION port. Rather
  // than copy the old rows across, the alerts are rebuilt from the PENDING
  // tasks themselves — which are the truth of what is waiting for whom, and are
  // still here. A dropped table cannot be read; an inbox can.
  //
  // Same shape and same sourceKey the engine publishes with, so the moment one
  // of these tasks is acted on, its alert is taken back like any other.
  await runOnce(
    prisma,
    'approval-alerts-rebuilt-from-pending-tasks',
    async () => {
      const tasks = await prisma.workflowTask.findMany({
        where: { status: 'PENDING', instance: { status: 'IN_PROGRESS' } },
        select: {
          id: true,
          assignedUserId: true,
          canApprove: true,
          instance: {
            select: {
              objectId: true,
              documentId: true,
              documentRef: true,
              companyId: true,
              branchId: true,
            },
          },
        },
      });
      if (!tasks.length) return;

      const objects = await prisma.objectMaster.findMany({
        where: {
          id: { in: [...new Set(tasks.map((t) => t.instance.objectId))] },
        },
        select: { id: true, objectName: true, route: true },
      });
      const byObject = new Map(objects.map((o) => [o.id, o]));

      await prisma.notification.createMany({
        data: tasks.map((t) => {
          const form = byObject.get(t.instance.objectId);
          const document = [form?.objectName, t.instance.documentRef]
            .filter(Boolean)
            .join(' ');
          return {
            userId: t.assignedUserId,
            category: 'APPROVAL' as const,
            title: t.canApprove ? 'Approval required' : 'For your review',
            body: `${document || 'A document'} ${
              t.canApprove ? 'needs your action' : 'has been sent to you'
            }.`,
            route: form?.route ?? null,
            documentId: t.instance.documentId,
            companyId: t.instance.companyId,
            branchId: t.instance.branchId,
            sourceKey: `workflow:task:${t.id}`,
          };
        }),
      });
    },
  );
}

/**
 * Run a step exactly once across every boot of every database, keyed by name.
 *
 * For the steps the additive sync cannot own: one that would overwrite data an
 * admin can legitimately change afterwards is safe to apply once, and wrong to
 * re-apply. The marker is written only after the step succeeds, so a failure
 * part-way leaves it to be retried on the next boot.
 */
async function runOnce(
  prisma: Prisma.TransactionClient,
  key: string,
  step: () => Promise<void>,
): Promise<void> {
  const applied = await prisma.scaffoldMigration.findUnique({ where: { key } });
  if (applied) return;
  await step();
  await prisma.scaffoldMigration.create({ data: { key } });
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
    tabs?: {
      key: string;
      label: string;
      order: number;
      hiddenByDefault?: boolean;
    }[];
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
      where: { companyId, name: ADMIN_GROUP_NAME },
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

/**
 * Shut a just-created hidden-by-default tab to the groups that already exist in
 * this company — everyone but Administrators.
 *
 * Only ever called with tabs created a moment ago, so it cannot re-close a tab
 * an admin has since opened. skipDuplicates covers the one case where a row
 * could already exist: a tab deleted and re-declared under the same key.
 */
async function closeNewTabsToExistingGroups(
  prisma: Prisma.TransactionClient,
  companyId: number,
  subMenuId: number,
  tabKeys: string[],
): Promise<void> {
  if (!tabKeys.length) return;

  const [tabs, groups] = await Promise.all([
    prisma.subMenuTab.findMany({
      where: { subMenuId, key: { in: tabKeys } },
      select: { id: true },
    }),
    prisma.userGroup.findMany({
      where: { companyId, name: { not: ADMIN_GROUP_NAME } },
      select: { id: true },
    }),
  ]);
  if (!tabs.length || !groups.length) return;

  await prisma.groupSubMenuTabAccess.createMany({
    data: groups.flatMap((g) =>
      tabs.map((t) => ({
        userGroupId: g.id,
        subMenuTabId: t.id,
        visible: false,
      })),
    ),
    skipDuplicates: true,
  });
}

/** Find/create one main menu, back-fill its sub-menus, and grant the admin group. */
/**
 * Make the SubMenuTab rows under one main menu match what the scaffold declares.
 *
 * Matched by (subMenu, key) so the row's id — which every group's hide/show
 * hangs off — survives a relabel or a reorder. Only tabs of the screens named in
 * this menu group are touched.
 */
async function syncSubMenuTabs(
  prisma: Prisma.TransactionClient,
  mainMenuId: number,
  companyId: number,
  subs: MenuGroup['subs'],
): Promise<void> {
  const declared = new Map(subs.map((s) => [s.route, s.tabs ?? []]));
  const rows = await prisma.subMenu.findMany({
    where: { mainMenuId },
    select: {
      id: true,
      route: true,
      tabs: {
        select: {
          id: true,
          key: true,
          label: true,
          sortOrder: true,
          hiddenByDefault: true,
        },
      },
    },
  });

  for (const sub of rows) {
    const want = declared.get(sub.route ?? '');
    // A screen this menu group does not declare at all is left alone; only a
    // screen that IS declared has its tab list treated as the whole truth.
    if (!want) continue;

    const have = new Map(sub.tabs.map((t) => [t.key, t]));

    const missing = want.filter((t) => !have.has(t.key));
    if (missing.length) {
      await prisma.subMenuTab.createMany({
        data: missing.map((t) => ({
          subMenuId: sub.id,
          key: t.key,
          label: t.label,
          sortOrder: t.order,
          hiddenByDefault: !!t.hiddenByDefault,
        })),
      });

      // A tab that starts shut has to be shut for the groups that already
      // exist, or declaring one on an established screen would hand it to
      // everybody who could already reach that screen. Done HERE, against the
      // tabs just created, so it happens exactly once per tab: on the next boot
      // they are no longer missing.
      await closeNewTabsToExistingGroups(
        prisma,
        companyId,
        sub.id,
        missing.filter((t) => t.hiddenByDefault).map((t) => t.key),
      );
    }

    for (const t of want) {
      const existing = have.get(t.key);
      if (
        existing &&
        (existing.label !== t.label ||
          existing.sortOrder !== t.order ||
          existing.hiddenByDefault !== !!t.hiddenByDefault)
      ) {
        await prisma.subMenuTab.update({
          where: { id: existing.id },
          data: {
            label: t.label,
            sortOrder: t.order,
            // Only the STARTING position for groups made after this point;
            // nobody's existing row is touched.
            hiddenByDefault: !!t.hiddenByDefault,
          },
        });
      }
    }

    const wanted = new Set(want.map((t) => t.key));
    const stale = sub.tabs.filter((t) => !wanted.has(t.key)).map((t) => t.id);
    if (stale.length) {
      // Cascades to GroupSubMenuTabAccess.
      await prisma.subMenuTab.deleteMany({ where: { id: { in: stale } } });
    }
  }
}

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

  // The screens' tabs. Additive like everything else here: a tab declared for
  // the first time is created, a relabelled or reordered one is corrected in
  // place (its id is what an admin's hide/show hangs off, so it must survive),
  // and a tab no longer declared is dropped along with those settings — it is
  // gone from the page, so an admin choice about it means nothing.
  //
  // No grant is written: a tab nobody has hidden is visible, so every group
  // that can reach the screen sees a new tab without a row existing at all.
  await syncSubMenuTabs(prisma, main.id, companyId, group.subs);

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

/**
 * The widgets an HR Dashboard opens with, and the metric each shows.
 *
 * A starting board, not a fixed one: it is written ONCE per company (see the
 * runOnce below), and from then on the dashboard belongs to whoever arranges
 * it in Cpanel → Dashboards. Adding a widget here later will not disturb a
 * board somebody has already made their own.
 *
 * Six of them, which the dashboard's three-column grid lays out as two rows:
 * how many people and how many are actually here on the first, then what is
 * changing and what it costs on the second.
 */
const HR_DASHBOARD_WIDGETS: {
  code: string;
  name: string;
  metric: string;
  hint: string;
  accent: string;
}[] = [
  // ---- first row: how many, and how many of them are actually here ----
  {
    code: 'HR_HEADCOUNT',
    name: 'Headcount',
    metric: 'hr.employees.active',
    hint: 'Active employees',
    accent: 'emerald',
  },
  {
    code: 'HR_IN_SERVICE',
    name: 'In Service',
    metric: 'hr.employees.inService',
    hint: 'Working today',
    accent: 'emerald',
  },
  {
    code: 'HR_ON_LEAVE',
    name: 'On Leave',
    metric: 'hr.employees.onLeave',
    hint: 'Away today',
    accent: 'blue',
  },
  // ---- second row: what is changing, and what it costs ----
  {
    code: 'HR_JOINED_MONTH',
    name: 'Joined This Month',
    metric: 'hr.employees.joinedThisMonth',
    hint: 'New this month',
    accent: 'blue',
  },
  {
    code: 'HR_ON_PROBATION',
    name: 'On Probation',
    metric: 'hr.employees.onProbation',
    hint: 'Awaiting confirmation',
    accent: 'amber',
  },
  {
    code: 'HR_MONTHLY_NET',
    name: 'Monthly Net Payable',
    metric: 'hr.salary.monthlyNet',
    hint: 'Packages in force today',
    accent: 'violet',
  },
];

/**
 * The widgets added with the employee-status field, by code.
 *
 * They are part of the starter set above now, so a fresh database gets them
 * from that. This list is only for the boards seeded BEFORE the status field
 * existed — see addHrStatusWidgets, whose marker those databases do not carry.
 */
const HR_STATUS_WIDGET_CODES = ['HR_IN_SERVICE', 'HR_ON_LEAVE'];

/**
 * Give every company's HR Dashboard a starting set of widgets.
 *
 * Dashboards and widgets are normally the admin's to build — this is the one
 * exception, so the HR Dashboard opens with something on it rather than an
 * empty board nobody knows what to do with. `runOnce`, emphatically: rebuilding
 * it every boot would undo the first rearrangement anybody made.
 *
 * Skipped WITHOUT marking itself done while the HR module or its dashboards are
 * missing — they are created by the sync above and by an admin respectively, so
 * a database that has neither yet simply seeds on a later boot.
 */
async function seedHrDashboardWidgets(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  await runOnce(prisma, 'hr-dashboard-starter-widgets', async () => {
    const hr = await prisma.module.findUnique({
      where: { code: 'HR' },
      select: { id: true },
    });
    if (!hr) return;

    const dashboards = await prisma.dashboard.findMany({
      where: { moduleId: hr.id },
      select: { id: true, companyId: true },
    });
    if (!dashboards.length) return;

    for (const dashboard of dashboards) {
      // A widget belongs to a company; a dashboard without one is global and
      // has no company's widgets to hang on it.
      if (dashboard.companyId == null) continue;

      for (const [i, w] of HR_DASHBOARD_WIDGETS.entries()) {
        const widget = await prisma.widget.upsert({
          where: {
            companyId_moduleId_code: {
              companyId: dashboard.companyId,
              moduleId: hr.id,
              code: w.code,
            },
          },
          update: {},
          create: {
            companyId: dashboard.companyId,
            moduleId: hr.id,
            code: w.code,
            name: w.name,
            type: WidgetType.METRIC,
            sortOrder: i + 1,
            config: {
              metric: w.metric,
              hint: w.hint,
              style: {
                shape: 'rounded',
                accent: w.accent,
                border: true,
                fontSize: 'xl',
                fontWeight: 'bold',
              },
            },
          },
          select: { id: true },
        });

        await prisma.dashboardWidget.upsert({
          where: {
            dashboardId_widgetId: {
              dashboardId: dashboard.id,
              widgetId: widget.id,
            },
          },
          update: {},
          create: {
            dashboardId: dashboard.id,
            widgetId: widget.id,
            sortOrder: i + 1,
            width: 1,
          },
        });
      }
    }
  });
}

/**
 * Put the two status widgets on boards that were seeded before the employee
 * status field existed.
 *
 * A migration of its own rather than a change to the starter list, because that
 * one has already run everywhere: adding to it would seed the new widgets on a
 * fresh database and nowhere else. Its own key means the boards already out
 * there get them too, once.
 *
 * Only ADDS. A board somebody has since rearranged keeps its arrangement, and
 * the two land at the end of it.
 */
async function addHrStatusWidgets(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  await runOnce(prisma, 'hr-dashboard-status-widgets', async () => {
    const hr = await prisma.module.findUnique({
      where: { code: 'HR' },
      select: { id: true },
    });
    if (!hr) return;

    const dashboards = await prisma.dashboard.findMany({
      where: { moduleId: hr.id },
      select: { id: true, companyId: true },
    });
    if (!dashboards.length) return;

    const wanted = HR_DASHBOARD_WIDGETS.filter((w) =>
      HR_STATUS_WIDGET_CODES.includes(w.code),
    );

    for (const dashboard of dashboards) {
      if (dashboard.companyId == null) continue;

      // Land after whatever is already on the board rather than at a fixed
      // position — the order there is somebody's, not ours.
      const last = await prisma.dashboardWidget.findFirst({
        where: { dashboardId: dashboard.id },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      let next = (last?.sortOrder ?? 0) + 1;

      for (const w of wanted) {
        const widget = await prisma.widget.upsert({
          where: {
            companyId_moduleId_code: {
              companyId: dashboard.companyId,
              moduleId: hr.id,
              code: w.code,
            },
          },
          update: {},
          create: {
            companyId: dashboard.companyId,
            moduleId: hr.id,
            code: w.code,
            name: w.name,
            type: WidgetType.METRIC,
            sortOrder: next,
            config: {
              metric: w.metric,
              hint: w.hint,
              style: {
                shape: 'rounded',
                accent: w.accent,
                border: true,
                fontSize: 'xl',
                fontWeight: 'bold',
              },
            },
          },
          select: { id: true },
        });

        await prisma.dashboardWidget.upsert({
          where: {
            dashboardId_widgetId: {
              dashboardId: dashboard.id,
              widgetId: widget.id,
            },
          },
          update: {},
          create: {
            dashboardId: dashboard.id,
            widgetId: widget.id,
            sortOrder: next,
            width: 1,
          },
        });
        next += 1;
      }
    }
  });
}
