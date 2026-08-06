/**
 * Deliberate revisions to the shipped Chart of Accounts — the log of what the
 * finance team has changed since Annexure D was signed off.
 *
 * The seed is additive: it creates what is missing and never writes over a row
 * that exists, so editing coa-data.ts alone changes a FRESH database only —
 * every database already carrying the chart would keep the old names for ever.
 * This is the other half of such a change, and it is written the same way as
 * COA_MAIN_GROUP_CORRECTIONS: each entry names the value the row was SHIPPED
 * with, and is applied only where that value is still there. A name someone has
 * since edited on the Groups or Ledgers screen is therefore left alone — a
 * redeploy corrects the shipped chart, it does not overrule the finance team.
 *
 * Keep coa-data.ts and this file in step: the data file is what a new database
 * gets, this is what an existing one is moved to. Both must state the same
 * ending position.
 */

import type { CcRequirement } from './coa-data';

export interface CoaRename {
  code: string;
  /** The name this row was shipped with; the rename is skipped if it differs. */
  from: string;
  to: string;
}

/** Group headings renamed after the first release. */
export const COA_GROUP_RENAMES: CoaRename[] = [
  // Sundry Creditors was the Tally habit; the block is Accounts Payable, and
  // the accounts under it now say what kind of payable each is.
  { code: '20000', from: 'Trade Payables', to: 'Accounts Payable' },
];

/** Ledger accounts renamed after the first release. */
export const COA_ACCOUNT_RENAMES: CoaRename[] = [
  // The payables block was split by WHAT WAS BOUGHT — raw material, packing,
  // traded goods, services, capital goods — which the purchase document already
  // records on its lines. It is split by the KIND OF LIABILITY instead: goods
  // and services bought on credit, everything else owed, and what has been
  // incurred but not yet billed.
  { code: '20001', from: 'Sundry Creditors - Raw Material', to: 'Trade Creditors' },
  { code: '20002', from: 'Sundry Creditors - Packing Material', to: 'Other Creditors' },
  { code: '20003', from: 'Sundry Creditors - Traded Goods', to: 'Accrued Expenses' },
  // "Sundry" is Tally's word, not the ledger's: these are the trade debtors,
  // split by channel. The Tally group they map to keeps its own name — that is
  // the migration key for the books being kept today, not a label anyone reads.
  {
    code: '13001',
    from: 'Sundry Debtors - Wholesale / B2B',
    to: 'Trade Debtors - Wholesale / B2B',
  },
  {
    code: '13002',
    from: 'Sundry Debtors - Institutional and Contract',
    to: 'Trade Debtors - Institutional and Contract',
  },
  {
    code: '13003',
    from: 'Sundry Debtors - Retail Credit',
    to: 'Trade Debtors - Retail Credit',
  },
  // Accruals moved to the payables block (20003), leaving this code free for the
  // one liability in the block worth keeping on its own: money HELD, not owed —
  // a deposit taken from a distributor or a tenant, repayable when the
  // arrangement ends. It takes the name from 23007, which is withdrawn below;
  // the rename runs first, so the code that keeps the balance is the one that
  // keeps the name.
  {
    code: '23002',
    from: 'Outstanding and Accrued Expenses',
    to: 'Security Deposits Received',
  },
];

/**
 * Accounts withdrawn from the master, with the name they were shipped with.
 *
 * Withdrawn, not deleted on sight: an account that has been POSTED TO is part of
 * the books and is deactivated instead, so the entries behind it stay readable
 * and the trial balance still adds up. Only an untouched account is removed
 * outright (its company adoptions go with it).
 */
export const COA_RETIRED_ACCOUNTS: { code: string; was: string }[] = [
  // Both fold into Trade Creditors / Other Creditors above.
  { code: '20004', was: 'Sundry Creditors - Services and Utilities' },
  { code: '20005', was: 'Sundry Creditors - Capital Goods' },
  // Other Current Liabilities kept a heading for each KIND of unpaid bill.
  // What is owed for a service consumed is a creditor, and the payables block
  // now says which kind, so these were the same liability recorded twice.
  { code: '23004', was: 'Electricity and Utilities Payable' },
  { code: '23005', was: 'Staff Meal Wallet and Coupon Liability' },
  { code: '23006', was: 'Gift Voucher and Prepaid Card Liability' },
  // Withdrawn as a code, not as a heading: 23002 above now carries it.
  { code: '23007', was: 'Security Deposits Received' },
  { code: '23008', was: 'Other Statutory Dues Payable' },
];

/**
 * What a line to an account is ASKED FOR — the cost-centre / cost-object rule,
 * for every account whose rule has been revised since the annexure, with the
 * rule it was SHIPPED with.
 *
 * These two boxes are settled when an account is created and read-only on the
 * drawer afterwards, because they change what a posting to it means; a revision
 * to the shipped rule therefore has nowhere else to be made.
 *
 * Only the OLD value lives here. The NEW one is coa-data.ts, which is the
 * master a fresh database seeds from — stating the target twice would be two
 * answers to one question. The seed moves an account only where it still
 * carries exactly what it was shipped with, so anything since adjusted by hand
 * is left as it was set.
 *
 * The sweep behind this list: a balance-sheet account asks for NEITHER
 * dimension — the balance belongs to the company, and the entry that created it
 * already carried the division on its profit-and-loss side, so asking again on
 * the asset or liability line only offers a second, quieter answer that no
 * report reconciles. A profit-and-loss account keeps its division and loses the
 * department; departments are added back one at a time, where they are actually
 * wanted.
 */
const WAS_MANDATORY = [
  '10103', '10201', '10202', '10203', '10204', '10205', '10301', '10302',
  '10401', '10402', '10501', '12001', '12002', '12003', '12004', '12005',
  '12006', '12007', '12008', '12009', '12010', '12011', '12012', '13003',
  '13004', '13005', '14102', '14103', '14104', '17004', '23004', '25001',
  '26003', '30001', '30002', '30003', '30004', '30005', '30006', '30007',
  '30008', '31001', '31002', '31003', '31004', '32001', '32002', '32003',
  '33001', '33002', '33003', '34001', '34003', '40001', '40002', '40003',
  '40004', '40005', '40006', '40007', '40008', '40009', '41001', '41002',
  '41003', '41004', '41005', '41006', '41007', '41008', '41010', '41011',
  '41012', '42001', '42002', '42003', '42004', '42005', '42006', '50001',
  '50002', '50003', '50004', '50005', '50006', '50009', '51001', '51002',
  '51004', '51005', '51006', '52001', '52002', '52003', '52004', '52005',
  '52006', '52008', '53002', '53011', '54001', '54002', '54003', '54004',
  '54005', '54006', '54007', '54008', '55002', '55003', '55004', '55005',
  '29003', '29006', '29007', '29008',
];

const WAS_OPTIONAL = [
  '10102', '10303', '10502', '10601', '10602', '10603', '10604', '10605',
  '12013', '13001', '13002', '13006', '14101', '14201', '14202', '15001',
  '15002', '15003', '15005', '15006', '23001', '23002', '23003', '25009',
  '26001', '26002', '22002', '27002', '29001',
];

export const COA_SHIPPED_CC_RULES: Record<string, CcRequirement> = {
  ...Object.fromEntries(WAS_MANDATORY.map((c) => [c, 'MANDATORY' as const])),
  ...Object.fromEntries(WAS_OPTIONAL.map((c) => [c, 'OPTIONAL' as const])),
};

/**
 * Accounts given a different code, to close the gaps the withdrawals above left
 * in a block.
 *
 * The account itself is untouched — same row, same id, so its adoptions, its
 * ledger and any bill sitting on it all travel with it. Applied only where the
 * old code still carries the name it was shipped with AND the new code is free,
 * so it can never overwrite an account someone has since created there.
 *
 * MOVED ONLY WHILE THE BLOCK IS UNPOSTED. A code is what the books are read by
 * and what a Tally import keys on; once entries exist against it, renumbering is
 * a reconciliation job, not a boot-time one.
 */
export const COA_RECODED_ACCOUNTS: {
  from: string;
  to: string;
  /** The name the row must still carry, as shipped. */
  name: string;
}[] = [
  // Closes the hole left by the two withdrawn creditors accounts, so the block
  // reads 20001-20004 without a gap.
  { from: '20006', to: '20004', name: 'Goods Received not Billed' },

  // ---- the numbering swept through, so every block reads consecutively ----
  //
  // The annexure parked its contra and clearing accounts at the 9 slot — 10900
  // Accumulated Depreciation under Fixed Assets, 13009 Provision for Doubtful
  // Debts — to make them sort last. They still sort last when they are simply
  // the last number in their block, so the gap bought nothing and cost a reader
  // the ability to tell a hole from a deletion.
  //
  // ORDER MATTERS in a run: 90005 must vacate 90005 before 90006 can take it.
  // Ascending, each move lands on a code the one before it has just left.
  { from: '10901', to: '10601', name: 'Accumulated Depreciation - Buildings' },
  { from: '10902', to: '10602', name: 'Accumulated Depreciation - Plant and Machinery' },
  { from: '10903', to: '10603', name: 'Accumulated Depreciation - Furniture and Fixtures' },
  { from: '10904', to: '10604', name: 'Accumulated Depreciation - Vehicles' },
  { from: '10905', to: '10605', name: 'Accumulated Depreciation - Office and IT Equipment' },
  { from: '10906', to: '10606', name: 'Accumulated Amortisation - Software' },
  { from: '13009', to: '13006', name: 'Provision for Doubtful Debts' },
  { from: '64010', to: '64008', name: 'Less: Staff Mess Recovery' },
  { from: '90005', to: '90004', name: 'Bank Reconciliation Clearing' },
  { from: '90006', to: '90005', name: 'Intercompany Elimination Clearing' },
  { from: '90007', to: '90006', name: 'Stock in Transit Clearing' },
  { from: '90008', to: '90007', name: 'Payroll Clearing' },
  { from: '90009', to: '90008', name: 'Offline Node Sync Clearing' },
  { from: '90010', to: '90009', name: 'Data Migration Clearing' },

  // ---- the liabilities side and below, renumbered to READ in order ----
  //
  // A statement is read owners' funds first, then what is owed long, then what
  // is owed short; the annexure numbered them the other way about, so the
  // printed chart ran 30000, 31000, 24000, 20000… A code that does not ascend
  // with the page it is printed on is a code nobody can scan.
  //
  // ORDER MATTERS, and it is not the obvious one: these moves form chains —
  // Provisions can only take 27000 once Intercompany Payable has left it. Each
  // entry below lands on a code the entries above it have already vacated, so
  // the list is applied top to bottom and never collides.
  { from: '23001', to: '26001', name: 'Advance from Customers' },
  { from: '23002', to: '26002', name: 'Security Deposits Received' },
  { from: '23003', to: '26003', name: 'Rent Payable' },
  { from: '27001', to: '28001', name: 'Due to Regency Food Products' },
  { from: '27002', to: '28002', name: 'Due to Regency Bakers and Confectionaries' },
  { from: '27003', to: '28003', name: 'Due to Regency Bake House' },
  { from: '90001', to: '29001', name: 'Suspense Account' },
  { from: '90002', to: '29002', name: 'Opening Balance Difference' },
  { from: '90003', to: '29003', name: 'POS Day-end Settlement Clearing' },
  { from: '90004', to: '29004', name: 'Bank Reconciliation Clearing' },
  { from: '90005', to: '29005', name: 'Intercompany Elimination Clearing' },
  { from: '90006', to: '29006', name: 'Stock in Transit Clearing' },
  { from: '90007', to: '29007', name: 'Payroll Clearing' },
  { from: '90008', to: '29008', name: 'Offline Node Sync Clearing' },
  { from: '90009', to: '29009', name: 'Data Migration Clearing' },
  { from: '70001', to: '45001', name: 'Interest Income' },
  { from: '70002', to: '45002', name: 'Rental Income' },
  { from: '70003', to: '45003', name: 'Discount Received' },
  { from: '70004', to: '45004', name: 'Profit on Sale of Fixed Assets' },
  { from: '70005', to: '45005', name: 'Insurance Claim Received' },
  { from: '70006', to: '45006', name: 'Miscellaneous Income' },
  { from: '70007', to: '45007', name: 'Rounding Off - Income' },
  { from: '80001', to: '66001', name: 'Interest on Term Loan' },
  { from: '80002', to: '66002', name: 'Interest on Working Capital and Overdraft' },
  { from: '80003', to: '66003', name: 'Interest on Vehicle and Equipment Loan' },
  { from: '80004', to: '66004', name: 'Interest on Statutory Dues' },
  { from: '80005', to: '66005', name: 'Loan Processing and Guarantee Charges' },
  { from: '81001', to: '67001', name: 'Loss on Sale of Fixed Assets' },
  { from: '81002', to: '67002', name: 'Donations and CSR Expenditure' },
  { from: '81003', to: '67003', name: 'Penalties, Fines and Late Fees' },
  { from: '82001', to: '68001', name: 'Income Tax Expense - Current' },
  { from: '82002', to: '68002', name: 'Deferred Tax Expense' },
  { from: '82003', to: '68003', name: 'Prior Period Adjustments' },
  { from: '25001', to: '27001', name: 'Provision for Income Tax' },
  { from: '25002', to: '27002', name: 'Provision for Expenses' },
  { from: '25003', to: '27003', name: 'Provision for Audit Fees' },
  { from: '22001', to: '25001', name: 'Salaries and Wages Payable' },
  { from: '22002', to: '25002', name: 'PF Payable - Employee Contribution' },
  { from: '22003', to: '25003', name: 'PF Payable - Employer Contribution' },
  { from: '22004', to: '25004', name: 'EPS / Pension Payable' },
  { from: '22005', to: '25005', name: 'ESI Payable - Employee Contribution' },
  { from: '22006', to: '25006', name: 'ESI Payable - Employer Contribution' },
  { from: '22007', to: '25007', name: 'Professional Tax Payable' },
  { from: '22008', to: '25008', name: 'Labour Welfare Fund Payable' },
  { from: '22009', to: '25009', name: 'Bonus Payable' },
  { from: '22010', to: '25010', name: 'Gratuity Provision' },
  { from: '22011', to: '25011', name: 'Leave Encashment Provision' },
  { from: '24001', to: '22001', name: 'Secured Term Loan - Bank' },
  { from: '24002', to: '22002', name: 'Vehicle and Equipment Loan' },
  { from: '24003', to: '22003', name: 'Bank Overdraft / Cash Credit' },
  { from: '24004', to: '22004', name: 'Unsecured Loan from Directors and Partners' },
  { from: '24005', to: '22005', name: 'Unsecured Loan - Others' },
  { from: '24006', to: '22006', name: 'Interest Accrued but not Due' },
  { from: '21001', to: '24001', name: 'Output CGST' },
  { from: '21002', to: '24002', name: 'Output SGST / UTGST' },
  { from: '21003', to: '24003', name: 'Output IGST' },
  { from: '21004', to: '24004', name: 'Output Cess' },
  { from: '21005', to: '24005', name: 'GST Payable (Net of Credit)' },
  { from: '21006', to: '24006', name: 'GST Payable under Reverse Charge' },
  { from: '21007', to: '24007', name: 'TDS Payable - Contractors (194C)' },
  { from: '21008', to: '24008', name: 'TDS Payable - Professional Fees (194J)' },
  { from: '21009', to: '24009', name: 'TDS Payable - Rent (194I)' },
  { from: '21010', to: '24010', name: 'TDS Payable - Salary (192B)' },
  { from: '21011', to: '24011', name: 'TCS Payable' },
  { from: '31001', to: '21001', name: 'General Reserve' },
  { from: '31002', to: '21002', name: 'Retained Earnings' },
  { from: '31003', to: '21003', name: 'Profit and Loss Account - Current Year' },
  { from: '31004', to: '21004', name: 'Revaluation Reserve' },
  { from: '20001', to: '23001', name: 'Trade Creditors' },
  { from: '20002', to: '23002', name: 'Other Creditors' },
  { from: '20003', to: '23003', name: 'Accrued Expenses' },
  { from: '20004', to: '23004', name: 'Goods Received not Billed' },
  { from: '30001', to: '20001', name: 'Share Capital / Partners Capital' },
  { from: '30002', to: '20002', name: 'Securities Premium' },
  { from: '30003', to: '20003', name: 'Current Account - Directors and Partners' },
  { from: '30004', to: '20004', name: 'Drawings' },

  // ---- and the profit and loss, down a decade each ----
  //
  // Moving equity to the head of the liabilities side emptied 3xxxx. Rather
  // than leave a decade standing empty in the middle of the chart, income takes
  // it, purchases and direct expenses take 4xxxx, and the indirect expenses
  // take 5xxxx. What is left free is now ABOVE the chart (6-9) rather than a
  // hole inside it.
  //
  // Same chained order as before: income must vacate 4xxxx before purchases can
  // have it, and purchases must vacate 5xxxx before the indirect expenses can.
  { from: '40001', to: '30001', name: 'Counter Sales - Bakery' },
  { from: '40002', to: '30002', name: 'Counter Sales - Pastry and Cakes' },
  { from: '40003', to: '30003', name: 'Counter Sales - Sweets and Savories' },
  { from: '40004', to: '30004', name: 'Counter Sales - Confectionery and Beverages' },
  { from: '40005', to: '30005', name: 'Cafe / Dine-in Sales - Food' },
  { from: '40006', to: '30006', name: 'Cafe / Dine-in Sales - Beverages and Juices' },
  { from: '40007', to: '30007', name: 'Custom Cake and Special Order Sales' },
  { from: '40008', to: '30008', name: 'Home Delivery and Takeaway Sales' },
  { from: '41001', to: '31001', name: 'Wholesale Sales - Bakery Products' },
  { from: '41002', to: '31002', name: 'Wholesale Sales - Confectionery and Beverages' },
  { from: '41003', to: '31003', name: 'Institutional and Contract Sales' },
  { from: '41004', to: '31004', name: 'Sales through Aggregators and Platforms' },
  { from: '42001', to: '32001', name: 'Intercompany Sales - to Regency Food Products' },
  { from: '42002', to: '32002', name: 'Intercompany Sales - to Regency Bakers' },
  { from: '42003', to: '32003', name: 'Intercompany Sales - to Regency Bake House' },
  { from: '43001', to: '33001', name: 'Sales Returns' },
  { from: '43002', to: '33002', name: 'Trade Discount Allowed' },
  { from: '43003', to: '33003', name: 'Scheme and Promotional Discount' },
  { from: '43004', to: '33004', name: 'Rounding Off - Sales' },
  { from: '44001', to: '34001', name: 'Delivery and Packing Charges Recovered' },
  { from: '44002', to: '34002', name: 'Sale of Scrap and By-products' },
  { from: '44003', to: '34003', name: 'Staff Mess - Guest and Visitor Meal Sales' },
  { from: '45001', to: '35001', name: 'Interest Income' },
  { from: '45002', to: '35002', name: 'Rental Income' },
  { from: '45003', to: '35003', name: 'Discount Received' },
  { from: '45004', to: '35004', name: 'Profit on Sale of Fixed Assets' },
  { from: '45005', to: '35005', name: 'Insurance Claim Received' },
  { from: '45006', to: '35006', name: 'Miscellaneous Income' },
  { from: '45007', to: '35007', name: 'Rounding Off - Income' },
  { from: '50001', to: '40001', name: 'Purchase - Flour, Sugar and Bulk Raw Material' },
  { from: '50002', to: '40002', name: 'Purchase - Dairy, Fats and Perishables' },
  { from: '50003', to: '40003', name: 'Purchase - Flavours, Additives and Ingredients' },
  { from: '50004', to: '40004', name: 'Purchase - Packing Material' },
  { from: '50005', to: '40005', name: 'Purchase - Traded Goods' },
  { from: '50006', to: '40006', name: 'Purchase - Mess and Canteen Provisions' },
  { from: '50007', to: '40007', name: 'Intercompany Purchases' },
  { from: '50008', to: '40008', name: 'Purchase Returns' },
  { from: '50009', to: '40009', name: 'Purchase Discount Received' },
  { from: '51001', to: '41001', name: 'Factory and Production Wages' },
  { from: '51002', to: '41002', name: 'Contract Labour - Production' },
  { from: '51003', to: '41003', name: 'Power and Fuel - Factory and Kitchen' },
  { from: '51004', to: '41004', name: 'LPG and Cooking Fuel' },
  { from: '51005', to: '41005', name: 'Water Charges - Factory' },
  { from: '51006', to: '41006', name: 'Consumables and Stores Consumed' },
  { from: '51007', to: '41007', name: 'Repairs and Maintenance - Plant and Machinery' },
  { from: '51008', to: '41008', name: 'Factory and Kitchen Rent' },
  { from: '51009', to: '41009', name: 'Quality Testing and Laboratory Charges' },
  { from: '51010', to: '41010', name: 'Freight Inward and Carriage' },
  { from: '51011', to: '41011', name: 'Production Wastage and Spoilage' },
  { from: '51012', to: '41012', name: 'Rework and Scrap Cost' },
  { from: '52001', to: '42001', name: 'Raw Material Consumed' },
  { from: '52002', to: '42002', name: 'Packing Material Consumed' },
  { from: '52003', to: '42003', name: 'Change in Inventory of WIP and Finished Goods' },
  { from: '52004', to: '42004', name: 'Cost of Traded Goods Sold' },
  { from: '52005', to: '42005', name: 'Stock Shortage and Excess on Physical Count' },
  { from: '52006', to: '42006', name: 'Expired and Damaged Stock Written Off' },
  { from: '60001', to: '50001', name: 'Salaries and Wages - Staff' },
  { from: '60002', to: '50002', name: 'Production Incentive and Piece-rate Pay' },
  { from: '60003', to: '50003', name: 'Outlet and Cafe Staff Wages' },
  { from: '60004', to: '50004', name: 'Employer PF Contribution' },
  { from: '60005', to: '50005', name: 'Employer ESI Contribution' },
  { from: '60006', to: '50006', name: 'Bonus and Ex-gratia' },
  { from: '60007', to: '50007', name: 'Gratuity Expense' },
  { from: '60008', to: '50008', name: 'Leave Encashment Expense' },
  { from: '60009', to: '50009', name: 'Staff Welfare Expenses' },
  { from: '60010', to: '50010', name: 'Staff Training and Recruitment' },
  { from: '60011', to: '50011', name: 'Employer Labour Welfare Fund' },
  { from: '61001', to: '51001', name: 'Freight Outward and Delivery' },
  { from: '61002', to: '51002', name: 'Vehicle Running and Maintenance' },
  { from: '61003', to: '51003', name: 'Advertisement and Publicity' },
  { from: '61004', to: '51004', name: 'Sales Promotion and Sampling' },
  { from: '61005', to: '51005', name: 'Aggregator and Platform Commission' },
  { from: '61006', to: '51006', name: 'Card, UPI and Payment Gateway Charges' },
  { from: '61007', to: '51007', name: 'Bad Debts Written Off' },
  { from: '61008', to: '51008', name: 'Provision for Doubtful Debts - Expense' },
  { from: '62001', to: '52001', name: 'Rent - Outlets and Offices' },
  { from: '62002', to: '52002', name: 'Electricity and Water - Outlets and Office' },
  { from: '62003', to: '52003', name: 'Repairs and Maintenance - Building' },
  { from: '62004', to: '52004', name: 'Repairs and Maintenance - Others' },
  { from: '62005', to: '52005', name: 'Housekeeping and Cleaning' },
  { from: '62006', to: '52006', name: 'Security Charges' },
  { from: '62007', to: '52007', name: 'Insurance' },
  { from: '62008', to: '52008', name: 'Rates and Taxes' },
  { from: '63001', to: '53001', name: 'Printing and Stationery' },
  { from: '63002', to: '53002', name: 'Telephone, Internet and Communication' },
  { from: '63003', to: '53003', name: 'Software Subscription and Cloud Hosting' },
  { from: '63004', to: '53004', name: 'Legal and Professional Charges' },
  { from: '63005', to: '53005', name: 'Audit Fees' },
  { from: '63006', to: '53006', name: 'Travelling and Conveyance' },
  { from: '63007', to: '53007', name: 'Bank Charges' },
  { from: '63008', to: '53008', name: 'Licence and Compliance Fees' },
  { from: '63009', to: '53009', name: 'Postage and Courier' },
  { from: '63010', to: '53010', name: 'Miscellaneous Expenses' },
  { from: '63011', to: '53011', name: 'Cash Shortage and Overage at Counter' },
  { from: '64001', to: '54001', name: 'Mess Provisions Consumed' },
  { from: '64002', to: '54002', name: 'Mess Staff Wages' },
  { from: '64003', to: '54003', name: 'Mess Fuel and Gas' },
  { from: '64004', to: '54004', name: 'Mess Utensils and Consumables' },
  { from: '64005', to: '54005', name: 'Mess Repairs and Maintenance' },
  { from: '64006', to: '54006', name: 'Mess Wastage and Leftover Loss' },
  { from: '64007', to: '54007', name: 'Contractor Mess Charges' },
  { from: '64008', to: '54008', name: 'Less: Staff Mess Recovery' },
  { from: '65001', to: '55001', name: 'Depreciation - Buildings' },
  { from: '65002', to: '55002', name: 'Depreciation - Plant and Machinery' },
  { from: '65003', to: '55003', name: 'Depreciation - Furniture and Fixtures' },
  { from: '65004', to: '55004', name: 'Depreciation - Vehicles' },
  { from: '65005', to: '55005', name: 'Depreciation - Office and IT Equipment' },
  { from: '65006', to: '55006', name: 'Amortisation - Software' },
  { from: '66001', to: '56001', name: 'Interest on Term Loan' },
  { from: '66002', to: '56002', name: 'Interest on Working Capital and Overdraft' },
  { from: '66003', to: '56003', name: 'Interest on Vehicle and Equipment Loan' },
  { from: '66004', to: '56004', name: 'Interest on Statutory Dues' },
  { from: '66005', to: '56005', name: 'Loan Processing and Guarantee Charges' },
  { from: '67001', to: '57001', name: 'Loss on Sale of Fixed Assets' },
  { from: '67002', to: '57002', name: 'Donations and CSR Expenditure' },
  { from: '67003', to: '57003', name: 'Penalties, Fines and Late Fees' },
  { from: '68001', to: '58001', name: 'Income Tax Expense - Current' },
  { from: '68002', to: '58002', name: 'Deferred Tax Expense' },
  { from: '68003', to: '58003', name: 'Prior Period Adjustments' },
];

/**
 * Group headings given a different code. Read exactly as the account recodes
 * above: same row, same id, so every account hanging off it comes along —
 * an account names its group by id, not by code.
 */
export const COA_RECODED_GROUPS: { from: string; to: string; name: string }[] = [
  // Accumulated Depreciation was the sixth block under Fixed Assets, numbered
  // ninth. Its accounts move with it, 10901-10906 to 10601-10606.
  { from: '10900', to: '10600', name: 'Accumulated Depreciation' },
  // The blocks of the liabilities side and below, in statement order — see
  // the note on the account moves above for why the sequence is what it is.
  { from: '23000', to: '26000', name: 'Other Current Liabilities' },
  { from: '27000', to: '28000', name: 'Intercompany Payable' },
  { from: '90000', to: '29000', name: 'Control, Clearing and Suspense' },
  { from: '70000', to: '45000', name: 'Other Income' },
  { from: '80000', to: '66000', name: 'Finance Costs' },
  { from: '81000', to: '67000', name: 'Non-operating Expenses' },
  { from: '82000', to: '68000', name: 'Taxation' },
  { from: '25000', to: '27000', name: 'Provisions' },
  { from: '22000', to: '25000', name: 'Employee Related Liabilities' },
  { from: '24000', to: '22000', name: 'Borrowings' },
  { from: '21000', to: '24000', name: 'Duties and Taxes Payable' },
  { from: '31000', to: '21000', name: 'Reserves and Surplus' },
  { from: '20000', to: '23000', name: 'Accounts Payable' },
  { from: '30000', to: '20000', name: 'Capital Account' },
  // The profit-and-loss blocks, a decade down each — see the note above.
  { from: '40000', to: '30000', name: 'Sales - Retail and Cafe' },
  { from: '41000', to: '31000', name: 'Sales - Wholesale and B2B' },
  { from: '42000', to: '32000', name: 'Sales - Intercompany' },
  { from: '43000', to: '33000', name: 'Sales Adjustments' },
  { from: '44000', to: '34000', name: 'Other Operating Income' },
  { from: '45000', to: '35000', name: 'Other Income' },
  { from: '50000', to: '40000', name: 'Purchases' },
  { from: '51000', to: '41000', name: 'Direct Expenses - Production' },
  { from: '52000', to: '42000', name: 'Cost of Goods Sold and Consumption' },
  { from: '60000', to: '50000', name: 'Employee Benefit Expenses' },
  { from: '61000', to: '51000', name: 'Selling and Distribution Expenses' },
  { from: '62000', to: '52000', name: 'Establishment and Occupancy Expenses' },
  { from: '63000', to: '53000', name: 'Administrative Expenses' },
  { from: '64000', to: '54000', name: 'Staff Mess and Canteen Expenses' },
  { from: '65000', to: '55000', name: 'Depreciation and Amortisation' },
  { from: '66000', to: '56000', name: 'Finance Costs' },
  { from: '67000', to: '57000', name: 'Non-operating Expenses' },
  { from: '68000', to: '58000', name: 'Taxation' },
];
