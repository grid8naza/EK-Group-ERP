import type { Prisma } from '@prisma/client';

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
}
