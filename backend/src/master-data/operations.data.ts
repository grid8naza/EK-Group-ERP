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

export interface SeedStore { companyId: number; code: string; name: string; isActive: boolean }
export interface SeedCostCenter { companyId: number; code: string; name: string; isActive: boolean }
export interface SeedCostObject { companyId: number; code: string; name: string; costCenterCode: string; isActive: boolean }

export const STORES: SeedStore[] = [
  { companyId: 1, code: "ST-0001", name: "Main Store", isActive: true },
  { companyId: 2, code: "ST-0001", name: "Kadathy Store", isActive: true },
  { companyId: 2, code: "ST-0002", name: "Kothamangalam Store", isActive: true },
  { companyId: 2, code: "ST-0003", name: "Muvattupuzha Store", isActive: true },
];

export const COST_CENTERS: SeedCostCenter[] = [
  { companyId: 1, code: "OD", name: "Operations Divisions", isActive: true },
  { companyId: 1, code: "SD", name: "Supporting Divisions", isActive: true },
  { companyId: 2, code: "RD", name: "Retail Division", isActive: true },
  { companyId: 2, code: "SD", name: "Supporting Division", isActive: true },
  { companyId: 3, code: "SD", name: "Supporting Division", isActive: true },
  { companyId: 3, code: "TD", name: "Trading Division", isActive: true },
];

export const COST_OBJECTS: SeedCostObject[] = [
  { companyId: 1, code: "AT", name: "Accounts", costCenterCode: "SD", isActive: true },
  { companyId: 1, code: "BY", name: "Bakery", costCenterCode: "OD", isActive: true },
  { companyId: 1, code: "CR", name: "Customer Relations", costCenterCode: "SD", isActive: true },
  { companyId: 1, code: "IY", name: "Inventory", costCenterCode: "SD", isActive: true },
  { companyId: 1, code: "PE", name: "Purchase", costCenterCode: "SD", isActive: true },
  { companyId: 1, code: "PG", name: "Packing", costCenterCode: "OD", isActive: true },
  { companyId: 1, code: "PY", name: "Pastry", costCenterCode: "OD", isActive: true },
  { companyId: 1, code: "SS", name: "Sweets and Savories", costCenterCode: "OD", isActive: true },
  { companyId: 2, code: "CE", name: "Cafe Service", costCenterCode: "RD", isActive: true },
  { companyId: 2, code: "CS", name: "Retail Counter", costCenterCode: "RD", isActive: true },
];
