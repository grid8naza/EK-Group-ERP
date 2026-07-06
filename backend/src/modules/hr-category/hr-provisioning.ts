/**
 * Screens shipped by the HR module (manpower classification masters). Consumed by
 * the module scaffold registry (module-scaffold.ts); the scaffold sync seeds
 * these as menus + privileges into every company's DB on boot. Routes match the
 * frontend page paths and the privilege keys used by the pages. Kept as a plain
 * literal (no import from the scaffold) so there is no module↔scaffold import
 * cycle.
 */
export const HR_SUBS = [
  {
    name: 'Category Master',
    route: '/hr/categories',
    icon: 'tag',
    order: 1,
  },
  {
    name: 'Group Master',
    route: '/hr/groups',
    icon: 'layers',
    order: 2,
  },
  {
    name: 'Designation Master',
    route: '/hr/designations',
    icon: 'id-card',
    order: 3,
  },
  // Per-module reference data. Super-admin-only; managed here so a module's
  // lookup values never leak into another module.
  {
    name: 'Lookups',
    route: '/hr/lookups',
    icon: 'list',
    order: 4,
    superAdminOnly: true,
  },
];
