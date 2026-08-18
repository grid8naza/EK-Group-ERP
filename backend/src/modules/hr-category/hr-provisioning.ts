import { ObjectType, Prisma } from '@prisma/client';

/**
 * Screens shipped by the HR module. Consumed by the module scaffold registry
 * (module-scaffold.ts); the scaffold sync seeds these as menus + privileges into
 * every company's DB on boot. Routes match the frontend page paths and the
 * privilege keys used by the pages. Kept as a plain literal (no import from the
 * scaffold) so there is no module↔scaffold import cycle.
 *
 * Three menus, split by what the rows ARE rather than by which service serves
 * them: the classification a person is described BY (HR Setup), the people
 * themselves (HR Records), and what is read back out (HR Analysis).
 */

/**
 * HR Setup — the module's PRIMARY menu, so the sync reuses its existing main
 * menu row rather than leaving one behind beside a new one (a primary is matched
 * by module, an extra by name). The rename in scaffold.sync relabels that row
 * from its earlier names ("Human Resources", then "HR Master"); without it an
 * existing database would keep the old one.
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
  {
    // The named working patterns — Morning, Night, General. A master, so it
    // sits with the other things a person is described by. Who is ON one is
    // the roster, which lives on the employee's own record.
    name: 'Shift Master',
    route: '/hr/shifts',
    icon: 'clock',
    order: 5,
  },
  {
    // The working day a branch keeps — what a fresh attendance sheet comes up
    // filled in with. Setup rather than Records: it is a rule, not a person.
    name: 'Attendance Settings',
    route: '/hr/attendance-settings',
    icon: 'clock',
    order: 6,
  },
  {
    name: 'Holiday Calendar',
    route: '/hr/holidays',
    icon: 'calendar-days',
    order: 7,
  },
];

/**
 * The rest of the HR menus. Extra menus are matched by NAME, so renaming one
 * here without a migration would leave the old menu — and every privilege on its
 * screens — behind, beside an empty twin.
 */
export const HR_EXTRA_MENUS = [
  {
    name: 'HR Records',
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
            // Where they have worked and as what. Visible by default, unlike
            // the two below: a service record is ordinary staff information,
            // and whoever maintains employees needs to read it.
            key: 'postings',
            label: 'Postings',
            order: 2,
          },
          {
            // Which shift they are on, and from when. Beside Postings because
            // it is the same kind of thing — a dated series about where and
            // how somebody works — and visible by default for the same reason.
            key: 'roster',
            label: 'Roster',
            order: 3,
          },
          {
            key: 'salary',
            label: 'Salary',
            order: 4,
            // What everybody earns, on one screen. Starts shut for the same
            // reason User Access does, and is opened per group from the
            // Privileges screen.
            hiddenByDefault: true,
          },
          {
            key: 'access',
            label: 'User Access',
            order: 5,
            // Logins and roles are given out here, so this one starts shut and
            // is opened per group from the Privileges screen.
            hiddenByDefault: true,
          },
        ],
      },
      {
        /**
         * The day's sheet for a branch. A form rather than a report: it is
         * marked, and then it goes through a workflow — who may mark, who
         * verifies and who approves is configured in Cpanel → Workflows
         * against this screen, not written into the code.
         */
        name: 'Attendance',
        route: '/hr/attendance',
        icon: 'calendar-check',
        order: 2,
      },
    ],
  },
  {
    /**
     * What is read back out of HR. Every screen here is tagged REPORT, which is
     * what makes the Privileges matrix offer Print / PDF / Excel on it instead
     * of Add / Edit / Delete — a report has nothing to add to.
     */
    name: 'HR Analysis',
    icon: 'report',
    subs: [
      {
        name: 'Employee List',
        route: '/hr/reports/employees',
        icon: 'users',
        order: 1,
        objectType: ObjectType.REPORT,
      },
      {
        name: 'Headcount Analysis',
        route: '/hr/reports/headcount',
        icon: 'bar-chart-3',
        order: 2,
        objectType: ObjectType.REPORT,
      },
      {
        name: 'Postings Register',
        route: '/hr/reports/postings',
        icon: 'map-pin',
        order: 3,
        objectType: ObjectType.REPORT,
      },
      {
        name: 'Salary Register',
        route: '/hr/reports/salary',
        icon: 'wallet',
        order: 4,
        objectType: ObjectType.REPORT,
      },
      {
        // The month on one page, a column per day — the sheet this module was
        // drawn from, assembled back out of the days that were marked.
        name: 'Attendance Register',
        route: '/hr/reports/attendance',
        icon: 'calendar-check',
        order: 5,
        objectType: ObjectType.REPORT,
      },
      {
        // Who is on which shift right now — the question a manager asks before
        // the week starts, and the one the roster exists to answer.
        name: 'Shift Roster',
        route: '/hr/reports/roster',
        icon: 'clock',
        order: 6,
        objectType: ObjectType.REPORT,
      },
      {
        // One person, one month, in and out and hours. What you print when
        // somebody queries their wage.
        name: 'Time Card',
        route: '/hr/reports/time-card',
        icon: 'clock',
        order: 7,
        objectType: ObjectType.REPORT,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// The HR module's own reference lists, maintained in HR → Lookups.
// ---------------------------------------------------------------------------

/**
 * The five lists the Employee Master picks from, and the values each starts
 * with.
 *
 * Lookups rather than fixed options because every one of them is the business's
 * to keep: another language when they hire from a new state, a grade above A, a
 * skill the bakery did not need last year. Blood group is here too, for
 * consistency — one place to look for every list the form offers — even though
 * the eight groups are a fact of medicine rather than a choice.
 *
 * The starting values are a first draft, not a policy. They are written only
 * when the lookup is first created; after that the list belongs to whoever
 * maintains it, and re-running must not resurrect a value they deleted or undo
 * a rename.
 *
 * A value is either a label (its stable code is derived from it) or an explicit
 * `{ code, label }` pair, for the lists where deriving would not work — "A+"
 * and "A-" both reduce to "A" once punctuation is stripped, and one would
 * silently swallow the other.
 */
export const HR_LOOKUPS: {
  code: string;
  name: string;
  values: (string | { code: string; label: string; alias?: string })[];
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
  {
    /**
     * Where somebody stands with the company today.
     *
     * "In Service" is the ordinary state — the standard HR term for a confirmed
     * employee currently working. Not "Active": the record already has an
     * Active flag, and two things called active on one form is one too many.
     *
     * Ordered as a working life runs rather than alphabetically, so the list
     * reads as a progression and the common answer is near the top.
     */
    code: 'EMPLOYEE_STATUS',
    name: 'Employee Status',
    values: [
      'On Probation',
      'In Service',
      'On Leave',
      'Resigned',
      'Terminated',
    ],
  },
  {
    /** What kind of engagement it is — how they are employed, not how they are. */
    code: 'EMPLOYEE_TYPE',
    name: 'Employee Type',
    values: ['Permanent', 'Part Time', 'Temporary'],
  },
  {
    // The pay components a salary package is built from. Lists rather than
    // columns so a new allowance never needs a migration — and so a payroll
    // report can pivot whatever the business has defined into a column each.
    code: 'SALARY_ALLOWANCE',
    name: 'Salary Allowance',
    values: [
      'House Rent Allowance',
      'Dearness Allowance',
      'Conveyance Allowance',
      'Medical Allowance',
      'Food Allowance',
      'Special Allowance',
      'Attendance Incentive',
    ],
  },
  {
    code: 'SALARY_DEDUCTION',
    name: 'Salary Deduction',
    values: [
      'Provident Fund',
      'ESI',
      'Professional Tax',
      'Income Tax (TDS)',
      'Salary Advance',
      'Loan Recovery',
      'Late / Absence',
    ],
  },
  {
    /**
     * What a day counted as — the kinds of day the business recognises.
     *
     * A list rather than an enum for the reason every list here is one: which
     * leaves exist is the business's to keep, and a new one ("Compensatory
     * Off") must not need a migration. The register pivots whatever is defined
     * into a column each, exactly as the salary register does with allowances.
     *
     * Every value carries an ALIAS, because the monthly register is a grid of
     * one cell per person per day and only a letter fits: P, A, HD, SL. They
     * are the same letters the attendance sheet this was drawn from has used
     * for years, so the printed page reads the way the office already reads it.
     */
    code: 'ATTENDANCE_TYPE',
    name: 'Attendance Type',
    values: [
      { code: 'PRESENT', label: 'Present', alias: 'P' },
      { code: 'HALF_DAY', label: 'Half Day', alias: 'HD' },
      { code: 'ABSENT', label: 'Absent', alias: 'A' },
      { code: 'SICK_LEAVE', label: 'Sick Leave', alias: 'SL' },
      { code: 'CASUAL_LEAVE', label: 'Casual Leave', alias: 'CL' },
      { code: 'VACATION', label: 'Vacation', alias: 'V' },
      { code: 'WEEKLY_OFF', label: 'Weekly Off', alias: 'WO' },
      { code: 'HOLIDAY', label: 'Holiday', alias: 'H' },
    ],
  },
  {
    code: 'BLOOD_GROUP',
    name: 'Blood Group',
    // Seeded in the order a form asks for it — by type, positive before
    // negative — which the sortOrder below preserves. Alphabetical would give
    // A+, A-, AB+, AB-, B+, and read as a mistake.
    //
    // Explicit codes: the sign is the whole distinction here, and stripping
    // punctuation would leave A+ and A- as the same "A".
    values: [
      { code: 'A_POS', label: 'A+' },
      { code: 'A_NEG', label: 'A-' },
      { code: 'B_POS', label: 'B+' },
      { code: 'B_NEG', label: 'B-' },
      { code: 'AB_POS', label: 'AB+' },
      { code: 'AB_NEG', label: 'AB-' },
      { code: 'O_POS', label: 'O+' },
      { code: 'O_NEG', label: 'O-' },
    ],
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
      data: spec.values.map((v, i) => {
        const label = typeof v === 'string' ? v : v.label;
        return {
          lookupId: lookup.id,
          value:
            typeof v === 'string'
              ? label
                  .toUpperCase()
                  .replace(/[’']/g, '')
                  .replace(/[^A-Z0-9]+/g, '_')
                  .replace(/^_|_$/g, '')
              : v.code,
          label,
          // The short form a grid is headed or filled with — "P" for Present,
          // "HRA" for House Rent Allowance. Only where one was given: an alias
          // is a convenience, and inventing one from the label would produce
          // exactly the noise it exists to avoid.
          alias: typeof v === 'string' ? null : (v.alias ?? null),
          sortOrder: i + 1,
        };
      }),
      skipDuplicates: true,
    });
  }
}
