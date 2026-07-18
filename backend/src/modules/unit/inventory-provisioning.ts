import { ObjectType, Prisma } from '@prisma/client';

/**
 * Inventory module scaffolding. Unit Master data is global, but the *menu* that
 * exposes it is per-company (like every other screen). This file enables the
 * Inventory module for every company and provisions its menu, mirroring the
 * Cpanel scaffold in company-provisioning.ts. Dashboards and widgets are NOT
 * auto-created — admins build them per module and grant them to groups.
 */

// Inventory sub-menu screens (shared routes; the data they manage is global).
export const INVENTORY_SUBS = [
  { name: 'Unit Master', route: '/inventory/units', icon: 'ruler', order: 1 },
  { name: 'Category Master', route: '/inventory/categories', icon: 'tag', order: 2 },
  { name: 'Group Master', route: '/inventory/groups', icon: 'layers', order: 3 },
  { name: 'HSN Code Master', route: '/inventory/hsn-codes', icon: 'percent', order: 4 },
  { name: 'Item Master', route: '/inventory/items', icon: 'box', order: 5 },
  // Products are split across two screens that share the /products backend and
  // are told apart by the packed/unpacked flags on each product.
  { name: 'Products - Unpacked', route: '/inventory/products-unpacked', icon: 'package-2', order: 6 },
  { name: 'Products - Packed', route: '/inventory/products-packed', icon: 'package', order: 7 },
  // Stock locations. The Opening Stock entry screens live in their own main
  // menu (OPENING_STOCK_MENU below), not under the master-data Inventory menu.
  { name: 'Store Master', route: '/inventory/stores', icon: 'warehouse', order: 8 },
  // Racks / shelves / bins inside a store — a product's default put-away location.
  { name: 'Rack Master', route: '/inventory/racks', icon: 'columns-3', order: 9 },
  // Per-module reference data. Super-admin-only; isolated from other modules.
  {
    name: 'Lookups',
    route: '/inventory/lookups',
    icon: 'list',
    order: 10,
    superAdminOnly: true,
  },
];

// Opening Stock — a separate main menu (its own sidebar section) holding the
// per-stockable-type opening-balance entry screens. Entered separately for
// raw-material items, packing-material items, unpacked and packed products.
export const OPENING_STOCK_MENU = {
  name: 'Opening Stock',
  icon: 'clipboard-list',
  subs: [
    { name: 'OS - Raw Material', route: '/inventory/opening-stock-raw-material', icon: 'clipboard-list', order: 1 },
    { name: 'OS - Packing Material', route: '/inventory/opening-stock-packing-material', icon: 'clipboard-list', order: 2 },
    { name: 'OS - Unpacked Products', route: '/inventory/opening-stock-unpacked-products', icon: 'clipboard-list', order: 3 },
    { name: 'OS - Packed Products', route: '/inventory/opening-stock-packed-products', icon: 'clipboard-list', order: 4 },
  ],
};

// Inventory Vouchers — the day-to-day stock-movement notes. Goods Receipt and
// Sales Return add stock (and a batch); Delivery, Purchase Return and Goods
// Issue remove it. All share the /stock-transactions backend, told apart by the
// note type.
export const INVENTORY_TXN_MENU = {
  name: 'Inventory Vouchers',
  icon: 'arrow-left-right',
  subs: [
    { name: 'Goods Receipt Notes', route: '/inventory/goods-receipt-note', icon: 'package-plus', order: 1 },
    { name: 'Delivery Notes', route: '/inventory/delivery-note', icon: 'truck', order: 2 },
    { name: 'Sales Return', route: '/inventory/sales-return', icon: 'undo-2', order: 3 },
    { name: 'Purchase Return', route: '/inventory/purchase-return', icon: 'redo-2', order: 4 },
    { name: 'Goods Issue Note', route: '/inventory/goods-issue-note', icon: 'package-minus', order: 5 },
  ],
};

// Production module screens. The recipe (ingredients + packing) for each product
// is edited here, while the product's master data lives under Inventory.
export const PRODUCTION_SUBS = [
  { name: 'Recipe Master', route: '/production/recipe-master', icon: 'list-tree', order: 1 },
  { name: 'Packing Master', route: '/production/packing-master', icon: 'package-check', order: 2 },
  // Production divisions — org units (Bakery, Pastry, …) that own primary groups.
  { name: 'Production Division', route: '/production/divisions', icon: 'factory', order: 3 },
  // Work Orders — what must be made to fulfil approved sales orders.
  { name: 'Work Order', route: '/production/work-orders', icon: 'hammer', order: 4 },
  // Per-module reference data. Super-admin-only; isolated from other modules.
  {
    name: 'Lookups',
    route: '/production/lookups',
    icon: 'list',
    order: 5,
    superAdminOnly: true,
  },
];

// Lookup code the Recipe Master's Process combo reads (kept in sync with the
// frontend PRODUCTION_PROCESS_LOOKUP_CODE constant). Module-scoped so admins
// manage the process list from Production → Lookups.
export const PRODUCTION_PROCESS_LOOKUP_CODE = 'PRODUCTION_PROCESS';

// Starter production process steps so the combo is usable out of the box; admins
// add more via Production → Lookups. Stored on the process as free text (the
// step's name), so the list can grow without a schema change.
const PRODUCTION_PROCESS_VALUES = [
  'Mixing',
  'Kneading',
  'Fermentation',
  'Proofing',
  'Boiling',
  'Baking',
  'Frying',
  'Cooling',
  'Cutting',
  'Decorating',
  'Packing',
];

/** One-time seed for Production defaults (guarded by code; safe every boot). */
export async function seedProductionDefaults(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  // Production Process lookup — created once, scoped to the Production module.
  // Guarded by code so re-runs (and admin edits to the value list) are preserved.
  const existing = await prisma.lookup.findFirst({
    where: { code: PRODUCTION_PROCESS_LOOKUP_CODE },
    select: { id: true },
  });
  if (existing) return;
  const productionModule = await prisma.module.findUnique({
    where: { code: 'PRODUCTION' },
    select: { id: true },
  });
  await prisma.lookup.create({
    data: {
      code: PRODUCTION_PROCESS_LOOKUP_CODE,
      name: 'Production Process',
      description: 'Process / step names used in a recipe’s process flow',
      moduleId: productionModule?.id ?? null,
      values: {
        create: PRODUCTION_PROCESS_VALUES.map((value, i) => ({
          value,
          label: value,
          sortOrder: i,
        })),
      },
    },
  });
}

// A second main menu under the Inventory module for reports (kept separate from
// the master-data "Inventory" menu).
export const INVENTORY_REPORT_MENUS = [
  {
    name: 'Inventory Report',
    icon: 'bar-chart-3',
    subs: [
      {
        name: 'Items List',
        route: '/inventory/reports/items',
        icon: 'file-text',
        order: 1,
        objectType: ObjectType.REPORT,
      },
      {
        name: 'Products List',
        route: '/inventory/reports/products',
        icon: 'package-open',
        order: 2,
        objectType: ObjectType.REPORT,
      },
      {
        name: 'Category List',
        route: '/inventory/reports/categories',
        icon: 'tag',
        order: 3,
        objectType: ObjectType.REPORT,
      },
      {
        name: 'Group List',
        route: '/inventory/reports/groups',
        icon: 'layers',
        order: 4,
        objectType: ObjectType.REPORT,
      },
    ],
  },
];

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
/** @deprecated Superseded by the unified scaffold sync (src/scaffold/scaffold.sync.ts). No longer wired. */
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
      // Skip super-admin-only screens (e.g. Lookups) — the SubMenu exists so
      // super admins can reach it, but the Administrators group isn't granted.
      const superAdminRoutes = new Set(
        INVENTORY_SUBS.filter(
          (s) => (s as { superAdminOnly?: boolean }).superAdminOnly,
        ).map((s) => s.route),
      );
      const subs = await prisma.subMenu.findMany({
        where: { mainMenuId: main.id },
        select: { id: true, route: true },
      });
      await prisma.groupSubMenuPrivilege.createMany({
        data: subs
          .filter((sub) => !superAdminRoutes.has(sub.route ?? ''))
          .map((sub) => ({
          userGroupId: adminGroup.id,
          subMenuId: sub.id,
          canMenu: true,
          canView: true,
          canAdd: true,
          canEdit: true,
          canDelete: true,
          canLock: true,
          canUnlock: true,
        })),
        skipDuplicates: true,
      });
    }
  }
}

// Common HSN codes for a bakery's ingredients & finished products, seeded once
// (only when the HSN table is empty) so the master isn't blank on first use.
// `gst` is the total GST %; it is split into CGST + SGST (half each) for
// intra-state and mirrored as IGST for inter-state, matching how the HSN form
// derives the three rates. Rates reflect India's GST 2.0 structure effective
// 22 Sep 2025 (most food items at NIL or 5%); verify against the latest
// notification / your CA, as a few preparations vary by exact sub-classification.
interface DefaultHsn {
  code: string;
  description: string;
  gst: number; // total %, 0 = exempt/NIL
}
const DEFAULT_HSN_CODES: DefaultHsn[] = [
  // --- Finished bakery products ---
  { code: '1905', description: 'Bread (branded & unbranded)', gst: 0 },
  { code: '190520', description: 'Rusk, toasted bread & similar toasted products', gst: 5 },
  { code: '190590', description: 'Pastry, cakes, biscuits & other bakers’ wares', gst: 5 },
  { code: '1704', description: 'Sugar confectionery (candy, toffee) without cocoa', gst: 5 },
  { code: '1806', description: 'Chocolate & other cocoa preparations', gst: 5 },
  { code: '2105', description: 'Ice cream & other edible ice', gst: 5 },
  // --- Flours, sugars & starches ---
  { code: '1101', description: 'Wheat flour, Maida & Atta', gst: 0 },
  { code: '1108', description: 'Starches (corn / maize starch)', gst: 5 },
  { code: '1701', description: 'Sugar (refined / granulated)', gst: 5 },
  { code: '1702', description: 'Glucose, invert sugar & sugar syrups', gst: 5 },
  { code: '1901', description: 'Malt extract & flour-based food preparations', gst: 5 },
  { code: '2106', description: 'Food preparations n.e.s. (baking premixes, custard powder, improvers)', gst: 5 },
  { code: '2102', description: 'Yeast & prepared baking powders', gst: 5 },
  // --- Dairy & fats ---
  { code: '0401', description: 'Fresh & UHT milk', gst: 0 },
  { code: '0402', description: 'Milk powder & condensed milk', gst: 5 },
  { code: '0405', description: 'Butter & ghee (dairy fats)', gst: 5 },
  { code: '0406', description: 'Cheese & paneer', gst: 5 },
  { code: '0407', description: 'Eggs (in shell)', gst: 0 },
  { code: '1512', description: 'Edible vegetable oil (sunflower / refined)', gst: 5 },
  { code: '1517', description: 'Margarine, bakery shortening & edible fat mixtures', gst: 5 },
  // --- Cocoa, fillings, nuts & flavourings ---
  { code: '1805', description: 'Cocoa powder', gst: 5 },
  { code: '2007', description: 'Jam, fruit jelly & marmalade', gst: 5 },
  { code: '0801', description: 'Cashew nuts', gst: 5 },
  { code: '0802', description: 'Almonds, walnuts, pistachios & other nuts', gst: 5 },
  { code: '0806', description: 'Raisins (dried grapes)', gst: 5 },
  { code: '0813', description: 'Mixed dried fruits', gst: 5 },
  { code: '0409', description: 'Natural honey', gst: 5 },
  { code: '0908', description: 'Cardamom, nutmeg & similar spices', gst: 5 },
  { code: '0905', description: 'Vanilla', gst: 5 },
  // --- Other staples ---
  { code: '2501', description: 'Salt', gst: 0 },
];

/** Seed common bakery HSN codes the first time (when the HSN table is empty). */
export async function seedDefaultHsnCodes(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  if ((await prisma.hsnCode.count()) > 0) return;
  await prisma.hsnCode.createMany({
    data: DEFAULT_HSN_CODES.map((h) => ({
      code: h.code,
      description: h.description,
      cgst: h.gst / 2,
      sgst: h.gst / 2,
      igst: h.gst,
    })),
    skipDuplicates: true,
  });
}

/** Run every Inventory data seed (each guards internally; safe on every boot). */
export async function seedInventoryDefaults(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  await seedDefaultUnits(prisma);
  await seedDefaultHsnCodes(prisma);
  await seedDeliveryTrips(prisma);
}

/** The delivery-trip lookup a packed product's Delivery Schedule chooses from. */
const DELIVERY_TRIP_LOOKUP = { code: 'DELIVERY_TRIP', name: 'Delivery Trip' };
const DEFAULT_DELIVERY_TRIPS = ['Trip 1', 'Trip 2', 'Trip 3', 'Trip 4'];

/**
 * Seed the Delivery Trip lookup and its four starting values.
 *
 * The trips are a lookup rather than fixed columns because they're the user's to
 * name — "Morning run", a fifth trip — and renaming or adding one shouldn't need
 * a developer. (The production days are the opposite: fixed by the calendar, so
 * they're plain flags on Product.)
 *
 * The VALUES are seeded only when the lookup is first created. After that they
 * are the user's: re-running must not resurrect a trip they deleted or undo a
 * rename.
 */
export async function seedDeliveryTrips(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  const inv = await prisma.module.findUnique({
    where: { code: 'INVENTORY' },
    select: { id: true },
  });
  const existing = await prisma.lookup.findUnique({
    where: { code: DELIVERY_TRIP_LOOKUP.code },
    select: { id: true },
  });
  if (existing) return;

  const lookup = await prisma.lookup.create({
    data: {
      code: DELIVERY_TRIP_LOOKUP.code,
      name: DELIVERY_TRIP_LOOKUP.name,
      moduleId: inv?.id ?? null,
      isSystem: true,
    },
  });
  await prisma.lookupValue.createMany({
    data: DEFAULT_DELIVERY_TRIPS.map((label, i) => ({
      lookupId: lookup.id,
      value: label.toUpperCase().replace(/\s+/g, '_'),
      label,
      sortOrder: i + 1,
    })),
    skipDuplicates: true,
  });
}

export async function seedDefaultUnits(
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
