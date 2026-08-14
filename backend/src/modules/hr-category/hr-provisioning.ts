import { type Prisma } from '@prisma/client';

/**
 * Screens shipped by the HR module. Consumed by the module scaffold registry
 * (module-scaffold.ts); the scaffold sync seeds these as menus + privileges into
 * every company's DB on boot. Routes match the frontend page paths and the
 * privilege keys used by the pages. Kept as a plain literal (no import from the
 * scaffold) so there is no module↔scaffold import cycle.
 *
 * Three menus, split by what the rows ARE rather than by which service serves
 * them: the classification a person is described BY (HR Master), the people
 * themselves (HR Data), and what is read back out (HR Reports).
 */

/**
 * HR Master — the module's PRIMARY menu, so the sync reuses its existing main
 * menu row rather than leaving one behind beside a new one (a primary is matched
 * by module, an extra by name). The one-time rename in scaffold.sync relabels
 * that row from "Human Resources"; without it an existing database would keep
 * the old name.
 */
export const HR_SUBS = [
  // Per-module reference data. Super-admin-only; managed here so a module's
  // lookup values never leak into another module.
  {
    name: 'Lookups',
    route: '/hr/lookups',
    icon: 'list',
    order: 1,
    superAdminOnly: true,
  },
  {
    name: 'Category Master',
    route: '/hr/categories',
    icon: 'tag',
    order: 2,
  },
  {
    name: 'Group Master',
    route: '/hr/groups',
    icon: 'layers',
    order: 3,
  },
  {
    name: 'Designation Master',
    route: '/hr/designations',
    icon: 'id-card',
    order: 4,
  },
];

/**
 * The rest of the HR menus. Extra menus are matched by NAME, so renaming one
 * here without a migration would leave the old menu — and every privilege on its
 * screens — behind, beside an empty twin.
 */
export const HR_EXTRA_MENUS = [
  {
    name: 'HR Data',
    icon: 'users',
    subs: [
      {
        // Not built yet. The menu row, the Object Master row and the privilege
        // column are seeded ahead of the screen on purpose, so an admin can
        // grant access before the page exists — the same way the Workplace
        // screens were staged.
        name: 'Employee Master',
        route: '/hr/employees',
        icon: 'user-cog',
        order: 1,
      },
    ],
  },
  {
    /**
     * Empty on purpose — reports are added one at a time as they are written.
     *
     * An empty menu is shown to super admins and hidden from everybody else
     * (see auth.service: `filter(mm => isSuperAdmin || mm.items.length > 0)`),
     * which is exactly the behaviour wanted here: whoever is building the module
     * can see the place reports will go, and staff are not shown a heading with
     * nothing under it.
     */
    name: 'HR Reports',
    icon: 'report',
    subs: [] as {
      name: string;
      route: string;
      icon: string;
      order: number;
    }[],
  },
];

/**
 * The lookup the Employee Master's Department dropdown reads (kept in sync with
 * DEPARTMENT_LOOKUP_CODE in modules/hr-employee). A lookup rather than a master
 * of its own: a department is a label an employee is filed under, with nothing
 * hanging off it — a whole master, with codes and a screen, would be four tables
 * of ceremony around a list of eight words. Module-scoped, so HR manages it from
 * HR → Lookups and it cannot leak into another module's dropdowns.
 */
export const DEPARTMENT_LOOKUP_CODE = 'DEPARTMENT';

// Starter departments so the dropdown is usable out of the box; HR adds their
// own from the Lookups screen. Deliberately the bakery's own shape rather than a
// generic corporate list.
const DEPARTMENT_VALUES = [
  'Production',
  'Packing',
  'Quality',
  'Stores',
  'Sales',
  'Delivery',
  'Maintenance',
  'Accounts',
  'Administration',
  'Housekeeping',
];

/** One-time seed for HR defaults (safe to run every boot). */
export async function seedHrDefaults(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  // Guarded by code so re-runs — and every edit HR has since made to the list —
  // are left alone.
  const existing = await prisma.lookup.findFirst({
    where: { code: DEPARTMENT_LOOKUP_CODE },
    select: { id: true },
  });
  if (existing) return;

  const hrModule = await prisma.module.findUnique({
    where: { code: 'HR' },
    select: { id: true },
  });
  await prisma.lookup.create({
    data: {
      code: DEPARTMENT_LOOKUP_CODE,
      name: 'Departments',
      description: 'Departments an employee belongs to',
      moduleId: hrModule?.id ?? null,
      values: {
        create: DEPARTMENT_VALUES.map((value, i) => ({
          value,
          label: value,
          sortOrder: i + 1,
        })),
      },
    },
  });
}
