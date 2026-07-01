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
];
