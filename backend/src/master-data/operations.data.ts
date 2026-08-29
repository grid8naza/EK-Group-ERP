/**
 * Company operating setup — the stores stock is held in, and the cost centres and objects a posting is analysed by.
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

export interface SeedBranch { companyId: number; code: string; name: string; isActive: boolean }
export interface SeedStore { companyId: number; code: string; name: string; isActive: boolean }
export interface SeedCostCenter { companyId: number; code: string; name: string; isActive: boolean }
export interface SeedCostObject { companyId: number; code: string; name: string; costCenterCode: string; categoryCode: string | null; isActive: boolean }

// Branches were not seeded at all until employees needed them. An employee names
// the branch they work at, a team is formed at one, and an attendance sheet is a
// single branch day — so a database with no branches leaves all three with
// nowhere to sit. Only a company with branchApplicable keeps them; company 2
// works in four, the other two from a head office.
export const BRANCHES: SeedBranch[] = [
  { companyId: 1, code: "HOF", name: "Head Office", isActive: true },
  { companyId: 2, code: "KDY", name: "Kadathy", isActive: true },
  { companyId: 2, code: "KLM", name: "Kothamangalam", isActive: true },
  { companyId: 2, code: "MTA", name: "Muvattupuzha", isActive: true },
  { companyId: 2, code: "VZM", name: "Vazhakulam", isActive: true },
  { companyId: 3, code: "HOF", name: "Head Office", isActive: true },
];

export const STORES: SeedStore[] = [
  { companyId: 1, code: "ST-0001", name: "Main Store", isActive: true },
  { companyId: 2, code: "ST-0001", name: "Kadathy Store", isActive: true },
  { companyId: 2, code: "ST-0002", name: "Kothamangalam Store", isActive: true },
  { companyId: 2, code: "ST-0003", name: "Muvattupuzha Store", isActive: true },
];

export const COST_CENTERS: SeedCostCenter[] = [
  { companyId: 1, code: "EL", name: "Executive Leadership", isActive: true },
  { companyId: 1, code: "OD", name: "Operations Divisions", isActive: true },
  { companyId: 1, code: "SD", name: "Supporting Divisions", isActive: true },
  { companyId: 2, code: "RD", name: "Retail Division", isActive: true },
  { companyId: 2, code: "SD", name: "Supporting Division", isActive: true },
  { companyId: 3, code: "SD", name: "Supporting Division", isActive: true },
  { companyId: 3, code: "TD", name: "Trading Division", isActive: true },
];

export const COST_OBJECTS: SeedCostObject[] = [
  { companyId: 1, code: "AT", name: "Accounts", costCenterCode: "SD", categoryCode: "DEPT", isActive: true },
  { companyId: 1, code: "BY", name: "Bakery", costCenterCode: "OD", categoryCode: "DEPT", isActive: true },
  { companyId: 1, code: "CGV", name: "Corporate Governance", costCenterCode: "EL", categoryCode: null, isActive: true },
  { companyId: 1, code: "CR", name: "Customer Relations", costCenterCode: "SD", categoryCode: "DEPT", isActive: true },
  { companyId: 1, code: "IY", name: "Inventory", costCenterCode: "SD", categoryCode: "DEPT", isActive: true },
  { companyId: 1, code: "OM", name: "Operations Management", costCenterCode: "OD", categoryCode: "DEPT", isActive: true },
  { companyId: 1, code: "PE", name: "Purchase", costCenterCode: "SD", categoryCode: "DEPT", isActive: true },
  { companyId: 1, code: "PG", name: "Packing", costCenterCode: "OD", categoryCode: "DEPT", isActive: true },
  { companyId: 1, code: "PY", name: "Pastry", costCenterCode: "OD", categoryCode: "DEPT", isActive: true },
  { companyId: 1, code: "SS", name: "Sweets and Savories", costCenterCode: "OD", categoryCode: "DEPT", isActive: true },
  { companyId: 2, code: "CE", name: "Cafe Service", costCenterCode: "RD", categoryCode: "CAFE", isActive: true },
  { companyId: 2, code: "CS", name: "Retail Counter", costCenterCode: "RD", categoryCode: "COUNTER", isActive: true },
];
