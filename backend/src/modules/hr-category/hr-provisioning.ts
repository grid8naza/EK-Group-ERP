import { Prisma } from '@prisma/client';

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

// ---------------------------------------------------------------------------
// The HR module's own reference lists, maintained in HR → Lookups.
// ---------------------------------------------------------------------------

/**
 * The four lists the Employee Master picks from, and the values each starts
 * with.
 *
 * Lookups rather than fixed options because every one of them is the business's
 * to keep: another language when they hire from a new state, a grade above A, a
 * skill the bakery did not need last year. Blood group is deliberately NOT here
 * — the eight groups are a fact of medicine, so the form holds them.
 *
 * The starting values are a first draft, not a policy. They are written only
 * when the lookup is first created; after that the list belongs to whoever
 * maintains it, and re-running must not resurrect a value they deleted or undo
 * a rename.
 */
export const HR_LOOKUPS: {
  code: string;
  name: string;
  values: string[];
}[] = [
  {
    code: 'EDUCATION',
    name: 'Education',
    values: [
      'Below SSLC',
      'SSLC',
      'Plus Two',
      'ITI',
      'Diploma',
      'Bachelor’s Degree',
      'Master’s Degree',
      'Doctorate',
      'Bakery / Culinary Certification',
    ],
  },
  {
    code: 'SKILL',
    name: 'Skill',
    values: [
      'Baking',
      'Pastry',
      'Cake Decoration',
      'Chocolate Work',
      'Dough Handling',
      'Machine Operation',
      'Packing',
      'Quality Checking',
      'Store Keeping',
      'Billing',
      'Driving',
      'Housekeeping',
    ],
  },
  {
    code: 'LANGUAGE',
    name: 'Language',
    values: [
      'Malayalam',
      'English',
      'Hindi',
      'Tamil',
      'Kannada',
      'Telugu',
      'Bengali',
      'Odia',
      'Arabic',
    ],
  },
  {
    code: 'EMPLOYEE_GRADE',
    name: 'Employee Grade',
    values: ['A', 'B', 'C', 'D', 'E'],
  },
];

/**
 * Create the HR lookups and their starting values.
 *
 * Guarded per lookup rather than all-or-nothing, so a list added here later
 * arrives on the next boot without disturbing the ones already in use. The
 * values go in only with the lookup itself — see the note above.
 *
 * `value` is the stable code, `label` what the form shows: renaming a grade
 * from "A" to "A — Senior" must not orphan the employees on it.
 */
export async function seedHrDefaults(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  const hr = await prisma.module.findUnique({
    where: { code: 'HR' },
    select: { id: true },
  });

  for (const spec of HR_LOOKUPS) {
    const existing = await prisma.lookup.findUnique({
      where: { code: spec.code },
      select: { id: true },
    });
    if (existing) continue;

    const lookup = await prisma.lookup.create({
      data: {
        code: spec.code,
        name: spec.name,
        moduleId: hr?.id ?? null,
        isSystem: true,
      },
    });
    await prisma.lookupValue.createMany({
      data: spec.values.map((label, i) => ({
        lookupId: lookup.id,
        value: label
          .toUpperCase()
          .replace(/[’']/g, '')
          .replace(/[^A-Z0-9]+/g, '_')
          .replace(/^_|_$/g, ''),
        label,
        sortOrder: i + 1,
      })),
      skipDuplicates: true,
    });
  }
}
