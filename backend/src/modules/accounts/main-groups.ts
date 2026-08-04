import { AccountNature, MainGroup } from '@prisma/client';

/**
 * The second level of the chart — the schedule each block of accounts reports
 * under.
 *
 * This is NOT from Annexure D, which classifies a block only by its nature and
 * leaves the reader to know that Inventories is current and Fixed Assets is
 * not. The statements are read at this level, so it is recorded rather than
 * inferred: the balance sheet splits non-current from current on both sides,
 * and the profit and loss separates what was bought, what was spent making it,
 * and what was spent running the place.
 *
 * Keyed by TOP-LEVEL group code. A sub-group reports under its parent's
 * schedule, so only the blocks carry one. It is a starting position, not a
 * ruling — every one of these is editable on the Account Groups screen, which
 * is where a call like "Borrowings is non-current" gets revisited when a loan
 * falls due within the year.
 */
export const COA_MAIN_GROUPS: Record<string, MainGroup> = {
  // ---- Assets ----
  '10000': 'NON_CURRENT_ASSET', // Fixed Assets
  '11000': 'NON_CURRENT_ASSET', // Investments
  '12000': 'CURRENT_ASSET', // Inventories
  '13000': 'CURRENT_ASSET', // Trade Receivables
  '14000': 'CURRENT_ASSET', // Cash and Bank Balances
  '15000': 'CURRENT_ASSET', // Loans, Advances and Deposits
  '16000': 'CURRENT_ASSET', // GST Input Tax Credit
  '17000': 'CURRENT_ASSET', // Intercompany and Inter-branch Receivable

  // ---- Liabilities, with owners' funds first: capital and reserves are what
  //      the business owes its owners, so they lead the side they sit on ----
  '20000': 'CURRENT_LIABILITY', // Trade Payables
  '21000': 'CURRENT_LIABILITY', // Duties and Taxes Payable
  '22000': 'CURRENT_LIABILITY', // Employee Related Liabilities
  '23000': 'CURRENT_LIABILITY', // Other Current Liabilities
  '24000': 'NON_CURRENT_LIABILITY', // Borrowings
  '25000': 'CURRENT_LIABILITY', // Provisions
  '27000': 'CURRENT_LIABILITY', // Intercompany Payable
  '30000': 'EQUITY_AND_RESERVES', // Capital Account
  '31000': 'EQUITY_AND_RESERVES', // Reserves and Surplus
  '90000': 'CURRENT_LIABILITY', // Control, Clearing and Suspense

  // ---- Income ----
  '40000': 'DIRECT_INCOME', // Sales - Retail and Cafe
  '41000': 'DIRECT_INCOME', // Sales - Wholesale and B2B
  '42000': 'DIRECT_INCOME', // Sales - Intercompany
  '43000': 'DIRECT_INCOME', // Sales Adjustments
  '44000': 'DIRECT_INCOME', // Other Operating Income
  '70000': 'INDIRECT_INCOME', // Other Income

  // ---- Expenses ----
  '50000': 'PURCHASE', // Purchases
  '51000': 'DIRECT_EXPENSE', // Direct Expenses - Production
  '52000': 'DIRECT_EXPENSE', // Cost of Goods Sold and Consumption
  '60000': 'INDIRECT_EXPENSE', // Employee Benefit Expenses
  '61000': 'INDIRECT_EXPENSE', // Selling and Distribution Expenses
  '62000': 'INDIRECT_EXPENSE', // Establishment and Occupancy Expenses
  '63000': 'INDIRECT_EXPENSE', // Administrative Expenses
  '64000': 'INDIRECT_EXPENSE', // Staff Mess and Canteen Expenses
  '65000': 'INDIRECT_EXPENSE', // Depreciation and Amortisation
  '80000': 'INDIRECT_EXPENSE', // Finance Costs
  '81000': 'INDIRECT_EXPENSE', // Non-operating Expenses
  '82000': 'INDIRECT_EXPENSE', // Taxation
};

/**
 * Which schedules a group of this nature may report under. Equity reports on
 * the liabilities side — capital and reserves are what the business owes its
 * owners, which is why they carry a credit balance and sit there — so both
 * natures may use any of that side's three schedules. A partner's current
 * account is a liability by nature and belongs with the owners' funds.
 */
export const MAIN_GROUPS_BY_NATURE: Record<AccountNature, MainGroup[]> = {
  ASSET: ['NON_CURRENT_ASSET', 'CURRENT_ASSET'],
  LIABILITY: [
    'EQUITY_AND_RESERVES',
    'NON_CURRENT_LIABILITY',
    'CURRENT_LIABILITY',
  ],
  EQUITY: ['EQUITY_AND_RESERVES', 'NON_CURRENT_LIABILITY', 'CURRENT_LIABILITY'],
  INCOME: ['DIRECT_INCOME', 'INDIRECT_INCOME'],
  EXPENSE: ['PURCHASE', 'DIRECT_EXPENSE', 'INDIRECT_EXPENSE'],
};

/**
 * Codes whose seeded schedule changed after the first release, with the value
 * they were shipped with. Applied ONLY where the group still carries the old
 * one, so a reclassification made on the Groups screen is never undone.
 */
export const COA_MAIN_GROUP_CORRECTIONS: {
  code: string;
  from: MainGroup;
  to: MainGroup;
}[] = [
  // Owners' funds were first shipped among the non-current liabilities; they
  // are their own schedule now, at the head of that side.
  { code: '30000', from: 'NON_CURRENT_LIABILITY', to: 'EQUITY_AND_RESERVES' },
  { code: '31000', from: 'NON_CURRENT_LIABILITY', to: 'EQUITY_AND_RESERVES' },
];
