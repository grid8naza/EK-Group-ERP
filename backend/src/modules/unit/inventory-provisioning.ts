import { GadgetType, ObjectType, Prisma } from '@prisma/client';

/**
 * Inventory module scaffolding. Unit Master data is global, but the *menu* that
 * exposes it is per-company (like every other screen). This file enables the
 * Inventory module for every company and provisions its menu + a company-wide
 * (all-branches) dashboard, mirroring the Cpanel scaffold in
 * company-provisioning.ts.
 */

// Inventory sub-menu screens (shared routes; the data they manage is global).
export const INVENTORY_SUBS = [
  { name: 'Unit Master', route: '/inventory/units', icon: 'ruler', order: 1 },
  { name: 'Category Master', route: '/inventory/categories', icon: 'tag', order: 2 },
  { name: 'Group Master', route: '/inventory/groups', icon: 'layers', order: 3 },
  { name: 'HSN Code Master', route: '/inventory/hsn-codes', icon: 'percent', order: 4 },
];

// Widgets for the Inventory Overview dashboard. UNITS_COUNT / CATEGORIES_COUNT
// are BUILTIN stat cards (resolved by code in the frontend WidgetView);
// INV_QUICK_LINKS is a LINKS gadget that lists the module's screens.
const INVENTORY_GADGETS: {
  code: string;
  name: string;
  description: string;
  type: GadgetType;
  width: number;
}[] = [
  { code: 'UNITS_COUNT', name: 'Units', description: 'Units of measure', type: 'BUILTIN', width: 1 },
  { code: 'CATEGORIES_COUNT', name: 'Categories', description: 'Item & product categories', type: 'BUILTIN', width: 1 },
  { code: 'INV_QUICK_LINKS', name: 'Quick Links', description: 'Jump to inventory screens', type: 'LINKS', width: 2 },
];
const INVENTORY_DASHBOARD_NAME = 'Inventory Overview';

// Default units seeded once (only when the Unit table is empty), so the master
// isn't blank on first use. Compounds reference a simple base by code.
interface DefaultUnit {
  code: string;
  name: string;
  symbol: string;
  type: 'SIMPLE' | 'COMPOUND';
  base?: string;
  factor?: number;
  decimalPlaces?: number;
}
// Each measurement family hangs off ONE simple base (the smallest unit), so
// purchase/sale in different units of the same family convert through it
// (e.g. buy in Kg, sell in Gram — both resolve to grams). The model is
// non-chaining, so every compound's base must be one of the simple units here.
const DEFAULT_UNITS: DefaultUnit[] = [
  // Count
  { code: 'NOS', name: 'Numbers', symbol: 'Nos', type: 'SIMPLE' },
  { code: 'PCS', name: 'Pieces', symbol: 'Pcs', type: 'SIMPLE' },
  // Weight — base is Gram
  { code: 'GM', name: 'Gram', symbol: 'g', type: 'SIMPLE', decimalPlaces: 2 },
  { code: 'KG', name: 'Kilogram', symbol: 'kg', type: 'COMPOUND', base: 'GM', factor: 1000, decimalPlaces: 3 },
  { code: 'TON', name: 'Tonne', symbol: 't', type: 'COMPOUND', base: 'GM', factor: 1000000, decimalPlaces: 3 },
  // Volume — base is Millilitre
  { code: 'ML', name: 'Millilitre', symbol: 'ml', type: 'SIMPLE', decimalPlaces: 2 },
  { code: 'LTR', name: 'Litre', symbol: 'L', type: 'COMPOUND', base: 'ML', factor: 1000, decimalPlaces: 3 },
  // Length
  { code: 'MTR', name: 'Metre', symbol: 'm', type: 'SIMPLE', decimalPlaces: 2 },
  // Packaging
  { code: 'DOZ', name: 'Dozen', symbol: 'Dz', type: 'COMPOUND', base: 'NOS', factor: 12 },
  { code: 'BOX', name: 'Box (10 pcs)', symbol: 'Box', type: 'COMPOUND', base: 'PCS', factor: 10 },
];

/**
 * Idempotent: enable the Inventory module + provision its menu for every
 * company, back-fill the global Object Master entries, and seed default units
 * the first time. Safe to run on every boot. New companies created at runtime
 * are picked up on the next restart.
 */
export async function backfillInventoryScaffold(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  const inventory = await prisma.module.findUnique({
    where: { code: 'INVENTORY' },
  });
  if (!inventory) return; // not seeded yet
  const invId = inventory.id;

  await seedDefaultUnits(prisma);

  // ---- Global Object Master entries (one per screen, company-independent) ----
  const existingRoutes = new Set(
    (
      await prisma.objectMaster.findMany({
        where: { moduleId: invId, objectType: ObjectType.FORM },
        select: { route: true },
      })
    ).map((o) => o.route),
  );
  for (const s of INVENTORY_SUBS) {
    if (existingRoutes.has(s.route)) continue;
    await prisma.objectMaster.create({
      data: {
        moduleId: invId,
        author: 'System',
        objectType: ObjectType.FORM,
        objectName: s.name,
        nameInMenu: s.name,
        showInMenu: true,
        route: s.route,
        icon: s.icon,
      },
    });
  }

  // Global DASHBOARD object the Inventory Overview dashboards link to.
  let dashObject = await prisma.objectMaster.findFirst({
    where: {
      moduleId: invId,
      objectType: ObjectType.DASHBOARD,
      objectName: INVENTORY_DASHBOARD_NAME,
    },
    select: { id: true },
  });
  if (!dashObject) {
    dashObject = await prisma.objectMaster.create({
      data: {
        moduleId: invId,
        author: 'System',
        objectType: ObjectType.DASHBOARD,
        objectName: INVENTORY_DASHBOARD_NAME,
        nameInMenu: INVENTORY_DASHBOARD_NAME,
        showInMenu: true,
        route: '/dashboard',
        icon: 'package',
      },
      select: { id: true },
    });
  }

  // ---- Per-company: enable module + menu + Administrators privileges ----
  const companies = await prisma.company.findMany({ select: { id: true } });
  for (const { id: companyId } of companies) {
    // Enable the Inventory module for the company.
    await prisma.companyModule.upsert({
      where: { companyId_moduleId: { companyId, moduleId: invId } },
      update: { isActive: true },
      create: {
        companyId,
        moduleId: invId,
        isActive: true,
        sortOrder: inventory.sortOrder ?? 0,
      },
    });

    const adminGroup = await prisma.userGroup.findFirst({
      where: { companyId, name: 'Administrators' },
      select: { id: true },
    });
    if (adminGroup) {
      // Let the Administrators group manage the Inventory module.
      await prisma.userGroupModule.upsert({
        where: {
          userGroupId_moduleId: {
            userGroupId: adminGroup.id,
            moduleId: invId,
          },
        },
        update: {},
        create: { userGroupId: adminGroup.id, moduleId: invId },
      });
    }

    // Reuse the company's existing Inventory main menu if there is one — matched
    // by MODULE, not name, so a renamed menu (e.g. "Inventory Master") is reused
    // instead of spawning a duplicate. Only create one when none exists.
    let main = await prisma.mainMenu.findFirst({
      where: { companyId, moduleId: invId },
      orderBy: { id: 'asc' },
    });
    if (!main) {
      main = await prisma.mainMenu.create({
        data: {
          companyId,
          moduleId: invId,
          menuName: 'Inventory',
          sortOrder: 1,
          objectType: ObjectType.FORM,
          isUserMenu: true,
          icon: 'package',
        },
      });
    }

    // Missing sub-menus.
    const have = new Set(
      (
        await prisma.subMenu.findMany({
          where: { mainMenuId: main.id },
          select: { route: true },
        })
      ).map((s) => s.route),
    );
    const missing = INVENTORY_SUBS.filter((s) => !have.has(s.route));
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

    if (adminGroup) {
      await prisma.groupMainMenuAccess.upsert({
        where: {
          userGroupId_mainMenuId: {
            userGroupId: adminGroup.id,
            mainMenuId: main.id,
          },
        },
        update: { visible: true },
        create: {
          userGroupId: adminGroup.id,
          mainMenuId: main.id,
          visible: true,
        },
      });
      const subs = await prisma.subMenu.findMany({
        where: { mainMenuId: main.id },
        select: { id: true },
      });
      await prisma.groupSubMenuPrivilege.createMany({
        data: subs.map((sub) => ({
          userGroupId: adminGroup.id,
          subMenuId: sub.id,
          canMenu: true,
          canView: true,
          canAdd: true,
          canEdit: true,
          canDelete: true,
        })),
        skipDuplicates: true,
      });
    }

    // ---- Gadgets + the all-branches Inventory Overview dashboard ----
    await prisma.gadget.createMany({
      data: INVENTORY_GADGETS.map((g, i) => ({
        companyId,
        moduleId: invId,
        code: g.code,
        name: g.name,
        description: g.description,
        type: g.type,
        sortOrder: i + 1,
      })),
      skipDuplicates: true, // unique [companyId, moduleId, code]
    });
    const gadgetIdByCode = new Map(
      (
        await prisma.gadget.findMany({
          where: { companyId, moduleId: invId },
          select: { id: true, code: true },
        })
      ).map((g) => [g.code, g.id]),
    );

    if (adminGroup) {
      await prisma.groupGadget.createMany({
        data: INVENTORY_GADGETS.map((g) => gadgetIdByCode.get(g.code))
          .filter((id): id is number => id != null)
          .map((gadgetId) => ({ userGroupId: adminGroup.id, gadgetId })),
        skipDuplicates: true,
      });
    }

    // One company-wide dashboard (branchId null = visible for every branch),
    // set as the module default so it loads when Inventory or a branch is
    // selected. Created once.
    const existingDash = await prisma.dashboard.findFirst({
      where: { companyId, moduleId: invId, name: INVENTORY_DASHBOARD_NAME },
      select: { id: true },
    });
    if (!existingDash) {
      const dash = await prisma.dashboard.create({
        data: {
          companyId,
          moduleId: invId,
          userGroupId: null, // visible to everyone in the module
          branchId: null, // company-wide → all branches
          objectId: dashObject?.id ?? null,
          name: INVENTORY_DASHBOARD_NAME,
          icon: 'package',
          sortOrder: 1,
          isDefault: true,
        },
      });
      const widgets = INVENTORY_GADGETS.map((g, i) => {
        const gadgetId = gadgetIdByCode.get(g.code);
        return gadgetId
          ? { dashboardId: dash.id, gadgetId, sortOrder: i + 1, width: g.width }
          : null;
      }).filter((w): w is NonNullable<typeof w> => w != null);
      if (widgets.length) {
        await prisma.dashboardWidget.createMany({ data: widgets });
      }
    }
  }
}

async function seedDefaultUnits(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  if ((await prisma.unit.count()) > 0) return;

  for (const u of DEFAULT_UNITS.filter((x) => x.type === 'SIMPLE')) {
    await prisma.unit.create({
      data: {
        code: u.code,
        name: u.name,
        symbol: u.symbol,
        type: 'SIMPLE',
        decimalPlaces: u.decimalPlaces ?? 0,
      },
    });
  }
  const idByCode = new Map(
    (await prisma.unit.findMany({ select: { id: true, code: true } })).map(
      (u) => [u.code, u.id],
    ),
  );
  for (const u of DEFAULT_UNITS.filter((x) => x.type === 'COMPOUND')) {
    const baseId = u.base ? idByCode.get(u.base) : undefined;
    if (!baseId) continue;
    await prisma.unit.create({
      data: {
        code: u.code,
        name: u.name,
        symbol: u.symbol,
        type: 'COMPOUND',
        baseUnitId: baseId,
        conversionFactor: u.factor,
        decimalPlaces: u.decimalPlaces ?? 0,
      },
    });
  }
}
