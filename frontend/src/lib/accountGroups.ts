import type { AccountNature, MainGroup } from '@/lib/types';

/**
 * The two tiers above a block of accounts.
 *
 * The PRIMARY group is what the account's nature already says — asset,
 * liability, income, expense. The MAIN group under it is the schedule the
 * statements are actually read in, and is recorded per block (AccountGroup.
 * mainGroup) rather than inferred.
 *
 * Order is the order a statement is read in: the balance sheet pair first, and
 * within each side non-current before current, as Schedule III sets them out.
 *
 * EQUITY reports with the liabilities — capital and reserves are what the
 * business owes its owners, which is why they carry a credit balance and sit on
 * that side of the sheet.
 */
export interface PrimaryGroup {
  key: string;
  label: string;
  natures: AccountNature[];
  mains: { key: MainGroup; label: string }[];
}

export const PRIMARY_GROUPS: PrimaryGroup[] = [
  {
    key: 'ASSET',
    label: 'Assets',
    natures: ['ASSET'],
    mains: [
      { key: 'NON_CURRENT_ASSET', label: 'Non-current Assets' },
      { key: 'CURRENT_ASSET', label: 'Current Assets' },
    ],
  },
  {
    key: 'LIABILITY',
    label: 'Liabilities',
    natures: ['LIABILITY', 'EQUITY'],
    mains: [
      { key: 'NON_CURRENT_LIABILITY', label: 'Non-current Liabilities' },
      { key: 'CURRENT_LIABILITY', label: 'Current Liabilities' },
    ],
  },
  {
    key: 'INCOME',
    label: 'Income',
    natures: ['INCOME'],
    mains: [
      { key: 'DIRECT_INCOME', label: 'Direct Income' },
      { key: 'INDIRECT_INCOME', label: 'Indirect Income' },
    ],
  },
  {
    key: 'EXPENSE',
    label: 'Expenses',
    natures: ['EXPENSE'],
    mains: [
      { key: 'PURCHASE', label: 'Purchase' },
      { key: 'DIRECT_EXPENSE', label: 'Direct Expense' },
      { key: 'INDIRECT_EXPENSE', label: 'Indirect Expense' },
    ],
  },
];

/** Every schedule, flattened — for a label lookup or a plain dropdown. */
export const MAIN_GROUPS = PRIMARY_GROUPS.flatMap((p) => p.mains);

export const mainGroupLabel = (key?: MainGroup | null) =>
  key ? (MAIN_GROUPS.find((m) => m.key === key)?.label ?? key) : '';

/** The schedules a group of this nature may report under. */
export const mainGroupsFor = (nature: AccountNature) =>
  PRIMARY_GROUPS.find((p) => p.natures.includes(nature))?.mains ?? [];

/** The primary group a nature belongs to. */
export const primaryOf = (nature: AccountNature) =>
  PRIMARY_GROUPS.find((p) => p.natures.includes(nature));
