/**
 * HR master — the designations whose rate per hour prices the manpower on every recipe process step.
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
 */

export interface SeedHrCategory { code: string; name: string; allCompanies: boolean; companies: number[] }
export interface SeedHrGroup { code: string; name: string; categoryCode: string; parentCode: string | null; level: number; subGroupApplicable: boolean; allCompanies: boolean; companies: number[] }
export interface SeedDesignation { code: string; name: string; categoryCode: string; groupCode: string; ratePerHour: number; allCompanies: boolean; companies: number[] }

export const HR_CATEGORIES: SeedHrCategory[] = [
  { code: "01000000000000000", name: "Workers", allCompanies: true, companies: [] },
];

export const HR_GROUPS: SeedHrGroup[] = [
  { code: "01010000000000000", name: "Skilled Worker", categoryCode: "01000000000000000", parentCode: null, level: 1, subGroupApplicable: false, allCompanies: true, companies: [] },
];

export const HR_DESIGNATIONS: SeedDesignation[] = [
  { code: "01010000000000001", name: "Skilled Baker", categoryCode: "01000000000000000", groupCode: "01010000000000000", ratePerHour: 150, allCompanies: true, companies: [] },
  { code: "01010000000000002", name: "Helper", categoryCode: "01000000000000000", groupCode: "01010000000000000", ratePerHour: 80, allCompanies: true, companies: [] },
];
