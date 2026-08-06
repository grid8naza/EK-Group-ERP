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
  '13004', '13005', '14102', '14103', '14104', '17004', '20004', '22001',
  '23003', '23004', '23005', '23006', '40001', '40002', '40003', '40004',
  '40005', '40006', '40007', '40008', '41001', '41002', '41003', '41004',
  '42001', '42002', '42003', '43001', '43002', '43003', '44001', '44003',
  '50001', '50002', '50003', '50004', '50005', '50006', '50007', '50008',
  '50009', '51001', '51002', '51003', '51004', '51005', '51006', '51007',
  '51008', '51010', '51011', '51012', '52001', '52002', '52003', '52004',
  '52005', '52006', '60001', '60002', '60003', '60004', '60005', '60006',
  '60009', '61001', '61002', '61004', '61005', '61006', '62001', '62002',
  '62003', '62004', '62005', '62006', '62008', '63002', '63011', '64001',
  '64002', '64003', '64004', '64005', '64006', '64007', '64010', '65002',
  '65003', '65004', '65005', '90003', '90007', '90008', '90009',
];

const WAS_OPTIONAL = [
  '10102', '10303', '10502', '10901', '10902', '10903', '10904', '10905',
  '12013', '13001', '13002', '13009', '14101', '14201', '14202', '15001',
  '15002', '15003', '15005', '15006', '20001', '20002', '20003', '22009',
  '23001', '23002', '23007', '24002', '25002', '90001',
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
  sortOrder: number;
}[] = [
  // Closes the hole left by the two withdrawn creditors accounts, so the block
  // reads 20001-20004 without a gap.
  {
    from: '20006',
    to: '20004',
    name: 'Goods Received not Billed',
    sortOrder: 89,
  },
];
