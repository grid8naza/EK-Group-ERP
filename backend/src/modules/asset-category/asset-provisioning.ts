import { ObjectType, type Prisma } from '@prisma/client';

/**
 * Screens shipped by the Asset module. Consumed by the module scaffold registry
 * (module-scaffold.ts); the scaffold sync seeds these as menus + privileges into
 * every company's DB on boot. Routes match the frontend page paths and the
 * privilege keys used by the pages. Kept as a plain literal (no import from the
 * scaffold) so there is no module↔scaffold import cycle.
 */
export const ASSET_SUBS = [
  {
    name: 'Asset Category Master',
    route: '/asset/asset-categories',
    icon: 'tag',
    order: 1,
  },
  {
    name: 'Asset Group Master',
    route: '/asset/asset-groups',
    icon: 'layers',
    order: 2,
  },
  { name: 'Asset Master', route: '/asset/assets', icon: 'box', order: 3 },
  // Per-module reference data (Brands, etc.). Super-admin-only; managed here so a
  // module's lookup values never leak into another module.
  {
    name: 'Lookups',
    route: '/asset/lookups',
    icon: 'list',
    order: 4,
    superAdminOnly: true,
  },
];

// A second main menu under the Asset module for reports (kept separate from the
// master-data "Asset" menu, mirroring how "Inventory Report" sits beside
// "Inventory"). Routes match the frontend report page paths and the privilege
// keys the pages pass to can(ROUTE, 'print' | 'downloadPdf' | 'downloadExcel').
export const ASSET_REPORT_MENUS = [
  {
    name: 'Asset Report',
    icon: 'bar-chart-3',
    subs: [
      {
        name: 'Asset List',
        route: '/asset/reports/assets',
        icon: 'file-text',
        order: 1,
        objectType: ObjectType.REPORT,
      },
      {
        name: 'Asset Category List',
        route: '/asset/reports/asset-categories',
        icon: 'tag',
        order: 2,
        objectType: ObjectType.REPORT,
      },
      {
        name: 'Asset Group List',
        route: '/asset/reports/asset-groups',
        icon: 'layers',
        order: 3,
        objectType: ObjectType.REPORT,
      },
    ],
  },
];

// Units used by the Asset Master's Capacity / Per-Unit that the inventory seed
// doesn't already provide. Seeded once (guarded by code) so the dropdowns are
// usable out of the box. Existing units (Pieces, Kilogram, Litre, Metre, Loaf,
// Packet, …) are left untouched.
const ASSET_UNITS: { code: string; name: string; symbol: string }[] = [
  { code: 'CUT', name: 'Cuts', symbol: 'cut' },
  { code: 'MIN', name: 'Minute', symbol: 'min' },
  { code: 'HR', name: 'Hour', symbol: 'hr' },
];

// Lookup code the Asset Master's Brand dropdown reads (kept in sync with the
// frontend ASSET_BRANDS_LOOKUP_CODE constant). A module-scoped lookup so admins
// manage the brand list from Cpanel → Lookups.
export const ASSET_BRANDS_LOOKUP_CODE = 'ASSET_BRANDS';

// Starter brands so the dropdown is usable out of the box; admins add more via
// Cpanel → Lookups. Values are stored on the asset as free text (Asset.brand),
// so the list can grow without a schema change.
const ASSET_BRAND_VALUES = ['Bosch', 'Siemens', 'ABB', 'Hitachi', 'Generic'];

/** One-time seed for Asset defaults (safe to run every boot). */
export async function seedAssetDefaults(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  for (const u of ASSET_UNITS) {
    const existing = await prisma.unit.findUnique({
      where: { code: u.code },
      select: { id: true },
    });
    if (!existing) {
      await prisma.unit.create({
        data: {
          code: u.code,
          name: u.name,
          symbol: u.symbol,
          type: 'SIMPLE',
          decimalPlaces: 0,
        },
      });
    }
  }

  // Brand lookup — created once, scoped to the Asset module. Guarded by code so
  // re-runs (and admin edits to the value list) are preserved.
  const existingBrands = await prisma.lookup.findFirst({
    where: { code: ASSET_BRANDS_LOOKUP_CODE },
    select: { id: true },
  });
  if (!existingBrands) {
    const assetModule = await prisma.module.findUnique({
      where: { code: 'ASSET' },
      select: { id: true },
    });
    await prisma.lookup.create({
      data: {
        code: ASSET_BRANDS_LOOKUP_CODE,
        name: 'Asset Brands',
        description: 'Brands / makes for assets and machines',
        moduleId: assetModule?.id ?? null,
        values: {
          create: ASSET_BRAND_VALUES.map((value) => ({ value, label: value })),
        },
      },
    });
  }
}
