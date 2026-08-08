/**
 * The inventory classification tree the business works to: the four categories
 * — raw material, packing material, semi-finished, finished — and the shared
 * group tree beneath them.
 *
 * Entered by hand once and captured here so it is not entered by hand again:
 * the seed beside this file creates whatever is missing on boot, so a new
 * database (or a colleague's) comes up with the same tree rather than an empty
 * Category screen and a list of names to retype.
 *
 * Written the same way as coa-data.ts — this is the master a database is
 * brought UP TO, and the seeder is additive: it creates what is absent and
 * never writes over a row that is there, so a category someone has since
 * renamed on the Category screen is left exactly as they renamed it.
 *
 * CODES ARE STATED, not generated. The 17-digit hierarchy code is positional
 * (see common/hierarchy-code.ts) and these are the codes the tree was built
 * with, so stating them keeps a seeded database and a hand-built one numbered
 * identically. A code already taken is a row that already exists, and is
 * skipped.
 *
 * COMPANIES ARE NAMED BY ID, matching how a company is referenced everywhere
 * else in the schema (companyId is a plain cross-domain id — see the Cpanel
 * boundary rule). The ids here are this installation's: 1 = EK001 EK Food
 * Products, 2 = EK002 EK Bake House, 3 = EK003 Regency Bakers.
 *
 * The seed therefore assumes a database whose companies were created in that
 * order. It checks each id against the company table first and skips (loudly)
 * any that is not there — but an id that IS there and belongs to a different
 * company cannot be detected, and would scope the tree to the wrong one. Keep
 * this list in step with the companies, and re-check it before seeding a
 * database whose companies were not created from the same script.
 */

import type { CategoryKind } from '@prisma/client';

export interface InventoryCategory {
  /** 17-digit hierarchy code: CC filled, everything below it zero. */
  code: string;
  name: string;
  kind: CategoryKind;
  /** true = every company; when false, `companies` names them by code. */
  allCompanies: boolean;
  companies: number[];
}

export interface InventoryGroup {
  /** 17-digit hierarchy code. A group carries no category, so CC stays 00. */
  code: string;
  name: string;
  /** 1 = primary group, up to 5. Parents are seeded before their children. */
  level: number;
  /** The group this one hangs under, by code; null at level 1. */
  parentCode: string | null;
  /** true = a container of sub-groups, which therefore holds no items itself. */
  subGroupApplicable: boolean;
  /** The categories this group serves, by category code. */
  categories: string[];
  allCompanies: boolean;
  companies: number[];
}

export const INVENTORY_CATEGORIES: InventoryCategory[] = [
  { code: "01000000000000000", name: "Raw Materials", kind: "INGREDIENT", allCompanies: false, companies: [2, 1] },
  { code: "02000000000000000", name: "Packing Materials", kind: "PACKING_MATERIAL", allCompanies: false, companies: [2, 1] },
  { code: "03000000000000000", name: "Semifinished Products", kind: "SEMI_FINISHED", allCompanies: false, companies: [1] },
  { code: "04000000000000000", name: "Finished Products", kind: "FINISHED", allCompanies: true, companies: [] },
];

export const INVENTORY_GROUPS: InventoryGroup[] = [
  { code: "00010000000000000", name: "Bakery", level: 1, parentCode: null, subGroupApplicable: true, categories: ["03000000000000000", "04000000000000000"], allCompanies: true, companies: [] },
  { code: "00010100000000000", name: "Breads & Loaves", level: 2, parentCode: "00010000000000000", subGroupApplicable: false, categories: ["03000000000000000", "04000000000000000"], allCompanies: false, companies: [1, 2] },
  { code: "00010200000000000", name: "Buns & Pavs", level: 2, parentCode: "00010000000000000", subGroupApplicable: false, categories: ["03000000000000000", "04000000000000000"], allCompanies: false, companies: [1, 2] },
  { code: "00010300000000000", name: "Rusks & Toasts", level: 2, parentCode: "00010000000000000", subGroupApplicable: false, categories: ["03000000000000000", "04000000000000000"], allCompanies: false, companies: [1, 2] },
  { code: "00010400000000000", name: "Cookies & Biscuits", level: 2, parentCode: "00010000000000000", subGroupApplicable: false, categories: ["03000000000000000", "04000000000000000"], allCompanies: false, companies: [1, 2] },
  { code: "00020000000000000", name: "Pastry", level: 1, parentCode: null, subGroupApplicable: true, categories: ["03000000000000000", "04000000000000000"], allCompanies: true, companies: [] },
  { code: "00020100000000000", name: "Celebration Cakes", level: 2, parentCode: "00020000000000000", subGroupApplicable: false, categories: ["03000000000000000", "04000000000000000"], allCompanies: false, companies: [1, 2] },
  { code: "00020200000000000", name: "Dry Cakes & Bar Cakes", level: 2, parentCode: "00020000000000000", subGroupApplicable: false, categories: ["03000000000000000", "04000000000000000"], allCompanies: false, companies: [1, 2] },
  { code: "00020300000000000", name: "Pastries & Slices", level: 2, parentCode: "00020000000000000", subGroupApplicable: false, categories: ["03000000000000000", "04000000000000000"], allCompanies: false, companies: [1, 2] },
  { code: "00020400000000000", name: "Tarts, Mousses & Cups", level: 2, parentCode: "00020000000000000", subGroupApplicable: false, categories: ["03000000000000000", "04000000000000000"], allCompanies: false, companies: [1, 2] },
  { code: "00030000000000000", name: "Sweets & Savories", level: 1, parentCode: null, subGroupApplicable: true, categories: ["03000000000000000", "04000000000000000"], allCompanies: true, companies: [] },
  { code: "00030100000000000", name: "Hot Savories & Puffs", level: 2, parentCode: "00030000000000000", subGroupApplicable: false, categories: ["03000000000000000", "04000000000000000"], allCompanies: false, companies: [1, 2] },
  { code: "00030200000000000", name: "Traditional Kerala Snacks", level: 2, parentCode: "00030000000000000", subGroupApplicable: false, categories: ["03000000000000000", "04000000000000000"], allCompanies: false, companies: [1, 2] },
  { code: "00030300000000000", name: "North/South Indian Sweets", level: 2, parentCode: "00030000000000000", subGroupApplicable: false, categories: ["03000000000000000", "04000000000000000"], allCompanies: false, companies: [1, 2] },
  { code: "00030400000000000", name: "Mixtures & Sev", level: 2, parentCode: "00030000000000000", subGroupApplicable: false, categories: ["03000000000000000", "04000000000000000"], allCompanies: false, companies: [1, 2] },
  { code: "00040000000000000", name: "Bulk Powders & Flours", level: 1, parentCode: null, subGroupApplicable: true, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00040100000000000", name: "Alternative Flours", level: 2, parentCode: "00040000000000000", subGroupApplicable: false, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00040200000000000", name: "Starches & Thickeners", level: 2, parentCode: "00040000000000000", subGroupApplicable: false, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00040300000000000", name: "Wheat Flours", level: 2, parentCode: "00040000000000000", subGroupApplicable: false, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00050000000000000", name: "Fats & Shortenings", level: 1, parentCode: null, subGroupApplicable: true, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00050100000000000", name: "Liquid Oils", level: 2, parentCode: "00050000000000000", subGroupApplicable: false, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00050200000000000", name: "Solid Fats", level: 2, parentCode: "00050000000000000", subGroupApplicable: false, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00060000000000000", name: "Fillings & Toppings", level: 1, parentCode: null, subGroupApplicable: true, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00060100000000000", name: "Creams & Pastes", level: 2, parentCode: "00060000000000000", subGroupApplicable: false, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00060200000000000", name: "Fruit Preps", level: 2, parentCode: "00060000000000000", subGroupApplicable: false, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00070000000000000", name: "Flavorings & Spices", level: 1, parentCode: null, subGroupApplicable: true, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00070100000000000", name: "Extracts & Pastes", level: 2, parentCode: "00070000000000000", subGroupApplicable: false, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00070200000000000", name: "Salts", level: 2, parentCode: "00070000000000000", subGroupApplicable: false, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00070300000000000", name: "Warm Spices", level: 2, parentCode: "00070000000000000", subGroupApplicable: false, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00080000000000000", name: "Inclusions & Mix-ins", level: 1, parentCode: null, subGroupApplicable: true, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00080100000000000", name: "Chocolates", level: 2, parentCode: "00080000000000000", subGroupApplicable: false, categories: ["01000000000000000"], allCompanies: true, companies: [] },
  { code: "00080200000000000", name: "Fruits & Nuts", level: 2, parentCode: "00080000000000000", subGroupApplicable: false, categories: ["01000000000000000"], allCompanies: true, companies: [] },
  { code: "00090000000000000", name: "Leavening Agents", level: 1, parentCode: null, subGroupApplicable: true, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00090100000000000", name: "Biological Leaveners", level: 2, parentCode: "00090000000000000", subGroupApplicable: false, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00090200000000000", name: "Chemical Leaveners", level: 2, parentCode: "00090000000000000", subGroupApplicable: false, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00100000000000000", name: "Liquids & Hydration", level: 1, parentCode: null, subGroupApplicable: true, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00100100000000000", name: "Juices & Acids", level: 2, parentCode: "00100000000000000", subGroupApplicable: false, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00100200000000000", name: "Plant-Based Milks", level: 2, parentCode: "00100000000000000", subGroupApplicable: false, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00100300000000000", name: "Water & Dairy", level: 2, parentCode: "00100000000000000", subGroupApplicable: false, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00110000000000000", name: "Sweeteners", level: 1, parentCode: null, subGroupApplicable: true, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00110100000000000", name: "Dry Sugars", level: 2, parentCode: "00110000000000000", subGroupApplicable: false, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00110200000000000", name: "Liquid Sweeteners", level: 2, parentCode: "00110000000000000", subGroupApplicable: false, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00120000000000000", name: "Miscellaneous Items", level: 1, parentCode: null, subGroupApplicable: false, categories: ["01000000000000000"], allCompanies: false, companies: [1] },
  { code: "00130000000000000", name: "Paper Wraps & Liners", level: 1, parentCode: null, subGroupApplicable: false, categories: ["02000000000000000"], allCompanies: false, companies: [1] },
  { code: "00140000000000000", name: "Bags & Pouches", level: 1, parentCode: null, subGroupApplicable: false, categories: ["02000000000000000"], allCompanies: false, companies: [1] },
  { code: "00150000000000000", name: "Bags & Pouches (Fried Items)", level: 1, parentCode: null, subGroupApplicable: false, categories: ["02000000000000000"], allCompanies: false, companies: [1] },
  { code: "00160000000000000", name: "Boxes & Cartons", level: 1, parentCode: null, subGroupApplicable: false, categories: ["02000000000000000"], allCompanies: false, companies: [1] },
  { code: "00170000000000000", name: "Sealing & Branding", level: 1, parentCode: null, subGroupApplicable: false, categories: ["02000000000000000"], allCompanies: false, companies: [1] },
];
