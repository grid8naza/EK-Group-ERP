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
        name: 'Employee Master',
        route: '/hr/employees',
        icon: 'user-cog',
        order: 1,
        /**
         * Two panes, and not everybody who maintains staff records should be
         * shown both. The keys are what the page passes to canTab(); the
         * labels are what the Privileges matrix lists.
         */
        tabs: [
          { key: 'employee', label: 'Employee', order: 1 },
          {
            key: 'access',
            label: 'User Access',
            order: 2,
            // Logins and roles are given out here, so this one starts shut and
            // is opened per group from the Privileges screen.
            hiddenByDefault: true,
          },
        ],
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
