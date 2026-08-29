/**
 * HR master — the category → group → designation tree, and the employees on it.
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
 * Logins are not seeded either. A login is created from the Employee Master's
 * User Access tab (User.employeeId is required), and seeding one would mean
 * seeding a password — see seed.ts, which owns the only account that ships.
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
  { code: "01010000000000001", name: "Master Baker", categoryCode: "01000000000000000", groupCode: "01010000000000000", ratePerHour: 150, allCompanies: false, companies: [2] },
  { code: "01010000000000002", name: "Pastry Chef", categoryCode: "01000000000000000", groupCode: "01010000000000000", ratePerHour: 0, allCompanies: false, companies: [1] },
  { code: "01010000000000003", name: "Pastry Chef", categoryCode: "01000000000000000", groupCode: "01010000000000000", ratePerHour: 0, allCompanies: false, companies: [2] },
  { code: "01010000000000004", name: "Bakery Assistant", categoryCode: "01000000000000000", groupCode: "01010000000000000", ratePerHour: 0, allCompanies: true, companies: [] },
  { code: "01010000000000005", name: "Cake Decorator", categoryCode: "01000000000000000", groupCode: "01010000000000000", ratePerHour: 0, allCompanies: true, companies: [] },
  { code: "01020000000000001", name: "Helper", categoryCode: "01000000000000000", groupCode: "01020000000000000", ratePerHour: 80, allCompanies: true, companies: [] },
  { code: "02010000000000001", name: "Front Office Staff", categoryCode: "02000000000000000", groupCode: "02010000000000000", ratePerHour: 0, allCompanies: true, companies: [] },
  { code: "02010000000000002", name: "Accountant", categoryCode: "02000000000000000", groupCode: "02010000000000000", ratePerHour: 0, allCompanies: true, companies: [] },
  { code: "02010000000000003", name: "Store Keeper", categoryCode: "02000000000000000", groupCode: "02010000000000000", ratePerHour: 0, allCompanies: true, companies: [] },
  { code: "02020000000000001", name: "Supervisor", categoryCode: "02000000000000000", groupCode: "02020000000000000", ratePerHour: 0, allCompanies: true, companies: [] },
  { code: "02020000000000002", name: "Chef", categoryCode: "02000000000000000", groupCode: "02020000000000000", ratePerHour: 0, allCompanies: true, companies: [] },
  { code: "03010000000000001", name: "Director", categoryCode: "03000000000000000", groupCode: "03010000000000000", ratePerHour: 0, allCompanies: true, companies: [] },
  { code: "03020000000000001", name: "Operations Manager", categoryCode: "03000000000000000", groupCode: "03020000000000000", ratePerHour: 0, allCompanies: true, companies: [] },
  { code: "03020000000000002", name: "Finance Manager", categoryCode: "03000000000000000", groupCode: "03020000000000000", ratePerHour: 0, allCompanies: true, companies: [] },
  { code: "03020000000000003", name: "Branch Manager", categoryCode: "03000000000000000", groupCode: "03020000000000000", ratePerHour: 0, allCompanies: true, companies: [] },
];

// Ordered so that anybody's manager appears BEFORE them: reportsToCode is
// resolved against employees already seeded, and a forward reference would
// silently land as null.
export const HR_EMPLOYEES: SeedEmployee[] = [
  { code: "EKF0001", name: "Kevin Sunny", companyId: 1, branchCode: "HOF", designationCode: "03010000000000001", dateOfJoin: "2000-01-01", reportsToCode: null, costCenterCode: "EL", costObjectCode: null, isActive: true },
  { code: "EKF0002", name: "Nevin Sunny", companyId: 1, branchCode: "HOF", designationCode: "03010000000000001", dateOfJoin: "2000-01-01", reportsToCode: null, costCenterCode: "EL", costObjectCode: null, isActive: true },
  { code: "EKF0003", name: "Santhosh Kumar", companyId: 1, branchCode: "HOF", designationCode: "03020000000000001", dateOfJoin: "2010-01-01", reportsToCode: "EKF0001", costCenterCode: "OD", costObjectCode: "OM", isActive: true },
  { code: "EKF0004", name: "Sheeba Joseph", companyId: 1, branchCode: "HOF", designationCode: "02010000000000001", dateOfJoin: "2010-05-10", reportsToCode: null, costCenterCode: "SD", costObjectCode: "CR", isActive: true },
  { code: "EKF0005", name: "Ajin Alexander", companyId: 1, branchCode: "HOF", designationCode: "02010000000000002", dateOfJoin: "2009-04-25", reportsToCode: null, costCenterCode: "SD", costObjectCode: "AT", isActive: true },
];
