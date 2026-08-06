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
];

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
