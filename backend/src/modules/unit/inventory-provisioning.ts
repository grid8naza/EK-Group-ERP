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
];

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
      },
      {
        name: 'Category List',
        route: '/inventory/reports/categories',
        icon: 'tag',
        order: 2,
      },
      {
        name: 'Group List',
        route: '/inventory/reports/groups',
        icon: 'layers',
        order: 3,
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
