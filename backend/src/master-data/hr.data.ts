/**
 * HR master — the category → group → designation tree, the employees on it, the
 * teams they work in, and the roles their logins are granted.
 *
 * Captured from the database this was first built in, so a new one comes up
 * with the same masters instead of an empty screen. The seeder beside this
 * file is additive and keyed on CODE: it creates what is missing and never
 * writes over a row that is already there.
 *
 * Cross-references are by code, resolved at seed time — an id means nothing in
 * another database. Companies are the exception and are named by id, matching
 * how companyId is carried everywhere else in the schema (1 = EK001,
 * 2 = EK002, 3 = EK003; seed.ts creates them in that order).
 *
 * A designation's `ratePerHour` is what prices the manpower on every recipe
 * process step, so a 0 here means that designation contributes nothing to a
 * recipe's labour cost yet.
 */

export interface SeedHrCategory { code: string; name: string; allCompanies: boolean; companies: number[] }
export interface SeedHrGroup { code: string; name: string; categoryCode: string; parentCode: string | null; level: number; subGroupApplicable: boolean; allCompanies: boolean; companies: number[] }
export interface SeedDesignation { code: string; name: string; categoryCode: string; groupCode: string; ratePerHour: number; allCompanies: boolean; companies: number[] }

/**
 * One employee. Deliberately NOT a copy of the whole Employee row: the personal
 * side of a staff record — Aadhaar, date of birth, home address, personal phone
 * and email, photograph — is left out on purpose, because this file is committed
 * and a national ID in git is permanent, reaches every clone, and survives being
 * deleted from the working tree. What is here is the ORGANISATIONAL fact: who
 * exists, what they do, where they sit and who they answer to. A real staff
 * record is entered on the Employee Master, and nothing here overwrites one.
 *
 * `photoUrl` is likewise absent: uploads are gitignored, so a seeded path would
 * point at a file no fresh checkout has and every card would show a broken image.
 *
 * LOGINS are not seeded either, and that is the firmest rule here. A login is
 * created from the Employee Master's User Access tab (User.employeeId is
 * required), and seeding one would mean committing a working username and
 * password — on every clone, for ever. The GROUPS those logins are put in ARE
 * seeded (see HR_USER_GROUPS), so the roles exist ready to be assigned; only the
 * accounts themselves are left to be made by hand.
 */
export interface SeedEmployee {
  code: string;
  name: string;
  /** 1 = EK001, 2 = EK002, 3 = EK003 — as everywhere else. */
  companyId: number;
  /** Branch CODE, resolved at seed time. Null where the company keeps none. */
  branchCode: string | null;
  designationCode: string;
  /** YYYY-MM-DD. */
  dateOfJoin: string;
  /** The employee CODE they report to, resolved at seed time. */
  reportsToCode: string | null;
  /** Division = cost centre CODE; department = cost object CODE under it. */
  costCenterCode: string | null;
  costObjectCode: string | null;
  isActive: boolean;
}

/** One person's dated spell in a team — see HrTeamMember on the model. */
export interface SeedTeamMember {
  employeeCode: string;
  /** YYYY-MM-DD. The day they join it. */
  effectiveFrom: string;
  /** The work the TEAM has them doing — not where the person sits on the master. */
  costCenterCode: string | null;
  costObjectCode: string | null;
}

/**
 * A team: who works together, under whom, and from when.
 *
 * The leader is an employee CODE rather than a user, matching the model — teams
 * are led by the person on the floor, and whether they hold a login is a
 * separate fact. A team whose leader or branch cannot be resolved is skipped
 * rather than half-created; `leaderEmployeeId` is required and a team nobody
 * answers for cannot mark a sheet.
 */
export interface SeedTeam {
  companyId: number;
  name: string;
  branchCode: string | null;
  leaderCode: string;
  /** Shift CODE the team works together, or null to fall back to each roster. */
  shiftCode: string | null;
  members: SeedTeamMember[];
}

/**
 * A role: which modules it may enter, and which screens it may open with what
 * rights.
 *
 * Screens are named by ROUTE, never by id — a sub-menu id is per company and
 * per database, while `/hr/attendance` is the same screen everywhere. Anything
 * not listed is simply not granted: the seeder writes only what is here, so a
 * role stays as small as it looks.
 *
 * Only the roles this project CREATED are seeded. Administrators is handed out
 * by the module scaffold, and the groups an admin has since drawn up by hand are
 * theirs — re-seeding those would be this file having opinions about somebody
 * else's access.
 */
export interface SeedUserGroup {
  name: string;
  companyId: number;
  description: string | null;
  /** Module CODEs (Workplace is added by the service whether listed or not). */
  moduleCodes: string[];
  screens: {
    route: string;
    /** Any of: view, add, edit, print. `print` also grants PDF and Excel. */
    actions: string[];
  }[];
}

export const HR_CATEGORIES: SeedHrCategory[] = [
  { code: "01000000000000000", name: "Workers", allCompanies: true, companies: [] },
  { code: "02000000000000000", name: "Staff", allCompanies: true, companies: [] },
  { code: "03000000000000000", name: "Management & Executives", allCompanies: true, companies: [] },
];

export const HR_GROUPS: SeedHrGroup[] = [
  { code: "01010000000000000", name: "Skilled Worker", categoryCode: "01000000000000000", parentCode: null, level: 1, subGroupApplicable: false, allCompanies: true, companies: [] },
  { code: "01020000000000000", name: "Unskilled Workers", categoryCode: "01000000000000000", parentCode: null, level: 1, subGroupApplicable: false, allCompanies: true, companies: [] },
  { code: "02010000000000000", name: "Supporting Staff", categoryCode: "02000000000000000", parentCode: null, level: 1, subGroupApplicable: false, allCompanies: true, companies: [] },
  { code: "02020000000000000", name: "Operations Staff", categoryCode: "02000000000000000", parentCode: null, level: 1, subGroupApplicable: false, allCompanies: true, companies: [] },
  { code: "03010000000000000", name: "Board of Directors", categoryCode: "03000000000000000", parentCode: null, level: 1, subGroupApplicable: false, allCompanies: true, companies: [] },
  { code: "03020000000000000", name: "Senior Managers", categoryCode: "03000000000000000", parentCode: null, level: 1, subGroupApplicable: false, allCompanies: true, companies: [] },
];

// NOTE: "Pastry Chef" is deliberately TWO rows — ...002 scoped to company 1 and
// ...003 to company 2 — exactly as the source database holds it. One row listing
// both companies would have done the same job; captured as-is rather than
// tidied, because the seeder must reproduce the database it was taken from.
export const HR_DESIGNATIONS: SeedDesignation[] = [
  { code: "01010000000000001", name: "Master Baker", categoryCode: "01000000000000000", groupCode: "01010000000000000", ratePerHour: 150, allCompanies: false, companies: [1, 2] },
  { code: "01010000000000002", name: "Pastry Chef", categoryCode: "01000000000000000", groupCode: "01010000000000000", ratePerHour: 0, allCompanies: false, companies: [1] },
  { code: "01010000000000003", name: "Pastry Chef", categoryCode: "01000000000000000", groupCode: "01010000000000000", ratePerHour: 0, allCompanies: false, companies: [2] },
  { code: "01010000000000004", name: "Bakery Assistant", categoryCode: "01000000000000000", groupCode: "01010000000000000", ratePerHour: 0, allCompanies: true, companies: [] },
  { code: "01010000000000005", name: "Cake Decorator", categoryCode: "01000000000000000", groupCode: "01010000000000000", ratePerHour: 0, allCompanies: true, companies: [] },
  { code: "01010000000000006", name: "Packing Assistant", categoryCode: "01000000000000000", groupCode: "01010000000000000", ratePerHour: 0, allCompanies: false, companies: [1] },
  { code: "01020000000000001", name: "Helper", categoryCode: "01000000000000000", groupCode: "01020000000000000", ratePerHour: 80, allCompanies: true, companies: [] },
  { code: "02010000000000001", name: "Front Office Staff", categoryCode: "02000000000000000", groupCode: "02010000000000000", ratePerHour: 0, allCompanies: true, companies: [] },
  { code: "02010000000000002", name: "Accountant", categoryCode: "02000000000000000", groupCode: "02010000000000000", ratePerHour: 0, allCompanies: true, companies: [] },
  { code: "02010000000000003", name: "Store Keeper", categoryCode: "02000000000000000", groupCode: "02010000000000000", ratePerHour: 0, allCompanies: true, companies: [] },
  { code: "02020000000000001", name: "Supervisor", categoryCode: "02000000000000000", groupCode: "02020000000000000", ratePerHour: 0, allCompanies: true, companies: [] },
  { code: "02020000000000002", name: "Chef", categoryCode: "02000000000000000", groupCode: "02020000000000000", ratePerHour: 0, allCompanies: true, companies: [] },
  { code: "02020000000000003", name: "Sales Staff", categoryCode: "02000000000000000", groupCode: "02020000000000000", ratePerHour: 0, allCompanies: false, companies: [2] },
  { code: "02020000000000004", name: "Cook", categoryCode: "02000000000000000", groupCode: "02020000000000000", ratePerHour: 0, allCompanies: false, companies: [2] },
  { code: "03010000000000001", name: "Director", categoryCode: "03000000000000000", groupCode: "03010000000000000", ratePerHour: 0, allCompanies: true, companies: [] },
  { code: "03020000000000001", name: "Operations Manager", categoryCode: "03000000000000000", groupCode: "03020000000000000", ratePerHour: 0, allCompanies: true, companies: [] },
  { code: "03020000000000002", name: "Finance Manager", categoryCode: "03000000000000000", groupCode: "03020000000000000", ratePerHour: 0, allCompanies: true, companies: [] },
  { code: "03020000000000003", name: "Branch Manager", categoryCode: "03000000000000000", groupCode: "03020000000000000", ratePerHour: 0, allCompanies: true, companies: [] },
];

// Ordered so that anybody's manager appears BEFORE them: reportsToCode is
// resolved against employees already seeded, and a forward reference would
// silently land as null.
//
// EK Food Products keeps its Operations division at head office — a supervisor
// and a skilled hand over three helpers in each of Bakery, Pastry, Sweets and
// Savories and Packing. EK Bake House runs four retail branches, each with a
// manager, a counter and a kitchen.
export const HR_EMPLOYEES: SeedEmployee[] = [
  { code: "EKF0001", name: "Kevin Sunny", companyId: 1, branchCode: "HOF", designationCode: "03010000000000001", dateOfJoin: "2000-01-01", reportsToCode: null, costCenterCode: "EL", costObjectCode: null, isActive: true },
  { code: "EKF0002", name: "Nevin Sunny", companyId: 1, branchCode: "HOF", designationCode: "03010000000000001", dateOfJoin: "2000-01-01", reportsToCode: null, costCenterCode: "EL", costObjectCode: null, isActive: true },
  { code: "EKF0003", name: "Santhosh Kumar", companyId: 1, branchCode: "HOF", designationCode: "03020000000000001", dateOfJoin: "2010-01-01", reportsToCode: "EKF0001", costCenterCode: "OD", costObjectCode: "OM", isActive: true },
  { code: "EKF0004", name: "Sheeba Joseph", companyId: 1, branchCode: "HOF", designationCode: "02010000000000001", dateOfJoin: "2010-05-10", reportsToCode: null, costCenterCode: "SD", costObjectCode: "CR", isActive: true },
  { code: "EKF0005", name: "Ajin Alexander", companyId: 1, branchCode: "HOF", designationCode: "02010000000000002", dateOfJoin: "2009-04-25", reportsToCode: null, costCenterCode: "SD", costObjectCode: "AT", isActive: true },
  { code: "EKF0006", name: "Thomas Jacob", companyId: 1, branchCode: "HOF", designationCode: "02020000000000001", dateOfJoin: "2012-05-02", reportsToCode: null, costCenterCode: "OD", costObjectCode: "BY", isActive: true },
  { code: "EKF0007", name: "Ravi Shankar", companyId: 1, branchCode: "HOF", designationCode: "01010000000000001", dateOfJoin: "2013-08-19", reportsToCode: null, costCenterCode: "OD", costObjectCode: "BY", isActive: true },
  { code: "EKF0008", name: "Anoop Das", companyId: 1, branchCode: "HOF", designationCode: "01020000000000001", dateOfJoin: "2019-03-11", reportsToCode: null, costCenterCode: "OD", costObjectCode: "BY", isActive: true },
  { code: "EKF0009", name: "Sunil Raj", companyId: 1, branchCode: "HOF", designationCode: "01020000000000001", dateOfJoin: "2020-06-22", reportsToCode: null, costCenterCode: "OD", costObjectCode: "BY", isActive: true },
  { code: "EKF0010", name: "Vishnu Prakash", companyId: 1, branchCode: "HOF", designationCode: "01020000000000001", dateOfJoin: "2021-01-09", reportsToCode: null, costCenterCode: "OD", costObjectCode: "BY", isActive: true },
  { code: "EKF0011", name: "Mary George", companyId: 1, branchCode: "HOF", designationCode: "02020000000000001", dateOfJoin: "2013-02-14", reportsToCode: null, costCenterCode: "OD", costObjectCode: "PY", isActive: true },
  { code: "EKF0012", name: "Neethu Joseph", companyId: 1, branchCode: "HOF", designationCode: "01010000000000002", dateOfJoin: "2015-11-30", reportsToCode: null, costCenterCode: "OD", costObjectCode: "PY", isActive: true },
  { code: "EKF0013", name: "Lakshmi Devi", companyId: 1, branchCode: "HOF", designationCode: "01020000000000001", dateOfJoin: "2019-09-02", reportsToCode: null, costCenterCode: "OD", costObjectCode: "PY", isActive: true },
  { code: "EKF0014", name: "Arun Chandran", companyId: 1, branchCode: "HOF", designationCode: "01020000000000001", dateOfJoin: "2020-10-13", reportsToCode: null, costCenterCode: "OD", costObjectCode: "PY", isActive: true },
  { code: "EKF0015", name: "Sneha Pillai", companyId: 1, branchCode: "HOF", designationCode: "01020000000000001", dateOfJoin: "2021-05-24", reportsToCode: null, costCenterCode: "OD", costObjectCode: "PY", isActive: true },
  { code: "EKF0016", name: "Abdul Rahman", companyId: 1, branchCode: "HOF", designationCode: "02020000000000001", dateOfJoin: "2011-07-07", reportsToCode: null, costCenterCode: "OD", costObjectCode: "SS", isActive: true },
  { code: "EKF0017", name: "Firoz Khan", companyId: 1, branchCode: "HOF", designationCode: "02020000000000002", dateOfJoin: "2014-04-28", reportsToCode: null, costCenterCode: "OD", costObjectCode: "SS", isActive: true },
  { code: "EKF0018", name: "Rahul Nambiar", companyId: 1, branchCode: "HOF", designationCode: "01020000000000001", dateOfJoin: "2018-12-01", reportsToCode: null, costCenterCode: "OD", costObjectCode: "SS", isActive: true },
  { code: "EKF0019", name: "Jithin Raj", companyId: 1, branchCode: "HOF", designationCode: "01020000000000001", dateOfJoin: "2020-02-17", reportsToCode: null, costCenterCode: "OD", costObjectCode: "SS", isActive: true },
  { code: "EKF0020", name: "Sajeev Kumar", companyId: 1, branchCode: "HOF", designationCode: "01020000000000001", dateOfJoin: "2021-08-30", reportsToCode: null, costCenterCode: "OD", costObjectCode: "SS", isActive: true },
  { code: "EKF0021", name: "Latha Krishnan", companyId: 1, branchCode: "HOF", designationCode: "02020000000000001", dateOfJoin: "2014-09-09", reportsToCode: null, costCenterCode: "OD", costObjectCode: "PG", isActive: true },
  { code: "EKF0022", name: "Praveen Kumar", companyId: 1, branchCode: "HOF", designationCode: "01010000000000006", dateOfJoin: "2016-06-16", reportsToCode: null, costCenterCode: "OD", costObjectCode: "PG", isActive: true },
  { code: "EKF0023", name: "Bindu Vijayan", companyId: 1, branchCode: "HOF", designationCode: "01020000000000001", dateOfJoin: "2019-04-05", reportsToCode: null, costCenterCode: "OD", costObjectCode: "PG", isActive: true },
  { code: "EKF0024", name: "Shibu Paul", companyId: 1, branchCode: "HOF", designationCode: "01020000000000001", dateOfJoin: "2020-11-11", reportsToCode: null, costCenterCode: "OD", costObjectCode: "PG", isActive: true },
  { code: "EKF0025", name: "Remya Suresh", companyId: 1, branchCode: "HOF", designationCode: "01020000000000001", dateOfJoin: "2022-01-03", reportsToCode: null, costCenterCode: "OD", costObjectCode: "PG", isActive: true },
  { code: "EKB0001", name: "Rajesh Menon", companyId: 2, branchCode: "KDY", designationCode: "03020000000000003", dateOfJoin: "2015-06-01", reportsToCode: null, costCenterCode: "RD", costObjectCode: null, isActive: true },
  { code: "EKB0002", name: "Anjali Nair", companyId: 2, branchCode: "KDY", designationCode: "02020000000000003", dateOfJoin: "2018-09-15", reportsToCode: null, costCenterCode: "RD", costObjectCode: "CS", isActive: true },
  { code: "EKB0003", name: "Biju Thomas", companyId: 2, branchCode: "KDY", designationCode: "02020000000000004", dateOfJoin: "2017-02-20", reportsToCode: null, costCenterCode: "RD", costObjectCode: "CE", isActive: true },
  { code: "EKB0004", name: "Vinod Kurian", companyId: 2, branchCode: "KLM", designationCode: "03020000000000003", dateOfJoin: "2016-01-11", reportsToCode: null, costCenterCode: "RD", costObjectCode: null, isActive: true },
  { code: "EKB0005", name: "Deepa Raj", companyId: 2, branchCode: "KLM", designationCode: "02020000000000003", dateOfJoin: "2019-07-01", reportsToCode: null, costCenterCode: "RD", costObjectCode: "CS", isActive: true },
  { code: "EKB0006", name: "Shaji Varghese", companyId: 2, branchCode: "KLM", designationCode: "02020000000000004", dateOfJoin: "2018-03-05", reportsToCode: null, costCenterCode: "RD", costObjectCode: "CE", isActive: true },
  { code: "EKB0007", name: "Prasad Pillai", companyId: 2, branchCode: "MTA", designationCode: "03020000000000003", dateOfJoin: "2014-11-03", reportsToCode: null, costCenterCode: "RD", costObjectCode: null, isActive: true },
  { code: "EKB0008", name: "Reshma Anil", companyId: 2, branchCode: "MTA", designationCode: "02020000000000003", dateOfJoin: "2020-01-20", reportsToCode: null, costCenterCode: "RD", costObjectCode: "CS", isActive: true },
  { code: "EKB0009", name: "Manoj Kumar", companyId: 2, branchCode: "MTA", designationCode: "02020000000000004", dateOfJoin: "2016-08-12", reportsToCode: null, costCenterCode: "RD", costObjectCode: "CE", isActive: true },
  { code: "EKB0010", name: "Suresh Babu", companyId: 2, branchCode: "VZM", designationCode: "03020000000000003", dateOfJoin: "2017-04-17", reportsToCode: null, costCenterCode: "RD", costObjectCode: null, isActive: true },
  { code: "EKB0011", name: "Divya Mohan", companyId: 2, branchCode: "VZM", designationCode: "02020000000000003", dateOfJoin: "2021-02-08", reportsToCode: null, costCenterCode: "RD", costObjectCode: "CS", isActive: true },
  { code: "EKB0012", name: "Jose Mathew", companyId: 2, branchCode: "VZM", designationCode: "02020000000000004", dateOfJoin: "2019-10-01", reportsToCode: null, costCenterCode: "RD", costObjectCode: "CE", isActive: true },
];

// One team per Operations department, each led by that department's own
// supervisor — the person who marks its daily sheet. Kevin Sunny's spell in the
// Bakery Team predates the rest and is kept at its own start date.
export const HR_TEAMS: SeedTeam[] = [
  { companyId: 1, name: "Bakery Team", branchCode: "HOF", leaderCode: "EKF0006", shiftCode: "M", members: [
    { employeeCode: "EKF0001", effectiveFrom: "2026-08-20", costCenterCode: "OD", costObjectCode: "BY" },
    { employeeCode: "EKF0006", effectiveFrom: "2026-09-01", costCenterCode: "OD", costObjectCode: "BY" },
    { employeeCode: "EKF0007", effectiveFrom: "2026-09-01", costCenterCode: "OD", costObjectCode: "BY" },
    { employeeCode: "EKF0008", effectiveFrom: "2026-09-01", costCenterCode: "OD", costObjectCode: "BY" },
    { employeeCode: "EKF0009", effectiveFrom: "2026-09-01", costCenterCode: "OD", costObjectCode: "BY" },
    { employeeCode: "EKF0010", effectiveFrom: "2026-09-01", costCenterCode: "OD", costObjectCode: "BY" },
  ] },
  { companyId: 1, name: "Pastry Team", branchCode: "HOF", leaderCode: "EKF0011", shiftCode: null, members: [
    { employeeCode: "EKF0011", effectiveFrom: "2026-09-01", costCenterCode: "OD", costObjectCode: "PY" },
    { employeeCode: "EKF0012", effectiveFrom: "2026-09-01", costCenterCode: "OD", costObjectCode: "PY" },
    { employeeCode: "EKF0013", effectiveFrom: "2026-09-01", costCenterCode: "OD", costObjectCode: "PY" },
    { employeeCode: "EKF0014", effectiveFrom: "2026-09-01", costCenterCode: "OD", costObjectCode: "PY" },
    { employeeCode: "EKF0015", effectiveFrom: "2026-09-01", costCenterCode: "OD", costObjectCode: "PY" },
  ] },
  { companyId: 1, name: "Sweets Team", branchCode: "HOF", leaderCode: "EKF0016", shiftCode: null, members: [
    { employeeCode: "EKF0016", effectiveFrom: "2026-09-01", costCenterCode: "OD", costObjectCode: "SS" },
    { employeeCode: "EKF0017", effectiveFrom: "2026-09-01", costCenterCode: "OD", costObjectCode: "SS" },
    { employeeCode: "EKF0018", effectiveFrom: "2026-09-01", costCenterCode: "OD", costObjectCode: "SS" },
    { employeeCode: "EKF0019", effectiveFrom: "2026-09-01", costCenterCode: "OD", costObjectCode: "SS" },
    { employeeCode: "EKF0020", effectiveFrom: "2026-09-01", costCenterCode: "OD", costObjectCode: "SS" },
  ] },
  { companyId: 1, name: "Packing Team", branchCode: "HOF", leaderCode: "EKF0021", shiftCode: null, members: [
    { employeeCode: "EKF0021", effectiveFrom: "2026-09-01", costCenterCode: "OD", costObjectCode: "PG" },
    { employeeCode: "EKF0022", effectiveFrom: "2026-09-01", costCenterCode: "OD", costObjectCode: "PG" },
    { employeeCode: "EKF0023", effectiveFrom: "2026-09-01", costCenterCode: "OD", costObjectCode: "PG" },
    { employeeCode: "EKF0024", effectiveFrom: "2026-09-01", costCenterCode: "OD", costObjectCode: "PG" },
    { employeeCode: "EKF0025", effectiveFrom: "2026-09-01", costCenterCode: "OD", costObjectCode: "PG" },
  ] },
];

// The personal screens every login needs whatever their job: their day, what is
// waiting on them, their mail, their tasks. Spread into each role below rather
// than granted by the seeder on its own, so a role's whole reach is readable in
// one place.
const OWN_DAY = [
  { route: '/workplace/dashboard', actions: ['view'] },
  { route: '/workflow/approvals', actions: ['view', 'edit'] },
  { route: '/workplace/documents/for-review', actions: ['view'] },
  { route: '/workplace/mail/inbox', actions: ['view'] },
  { route: '/workplace/mail/sent', actions: ['view'] },
  { route: '/workplace/mail/drafts', actions: ['view'] },
  { route: '/workplace/mail/new', actions: ['view', 'add'] },
  { route: '/workplace/chat', actions: ['view', 'add'] },
  { route: '/workplace/alerts', actions: ['view'] },
  { route: '/workplace/tasks/assigned-to-me', actions: ['view', 'edit'] },
  { route: '/workplace/circulars/view', actions: ['view'] },
  { route: '/workplace/broadcast/view', actions: ['view'] },
];

export const HR_USER_GROUPS: SeedUserGroup[] = [
  {
    name: 'Sales Staff',
    companyId: 2,
    description: 'Counter sales staff — their own day, and the attendance they are marked on.',
    moduleCodes: ['HR'],
    // Reads the attendance they are marked on; does not mark it.
    screens: [
      ...OWN_DAY,
      { route: '/hr/attendance', actions: ['view'] },
      { route: '/hr/reports/time-card', actions: ['view', 'print'] },
    ],
  },
  {
    name: 'Kitchen Staff',
    companyId: 2,
    description: 'Branch kitchen staff — their own day, and the attendance they are marked on.',
    moduleCodes: ['HR'],
    screens: [
      ...OWN_DAY,
      { route: '/hr/attendance', actions: ['view'] },
      { route: '/hr/reports/time-card', actions: ['view', 'print'] },
    ],
  },
  {
    name: 'Production Staff',
    companyId: 1,
    description:
      'Operations division supervisors and skilled hands — marks its team attendance, reads production.',
    moduleCodes: ['HR', 'PRODUCTION'],
    // A supervisor MARKS the sheet, so add and edit — plus the team screens that
    // say whose sheet it is.
    screens: [
      ...OWN_DAY,
      { route: '/hr/attendance', actions: ['view', 'add', 'edit'] },
      { route: '/hr/teams', actions: ['view'] },
      { route: '/hr/reports/teams', actions: ['view', 'print'] },
      { route: '/hr/reports/time-card', actions: ['view', 'print'] },
    ],
  },
];
