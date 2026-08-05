import { ObjectType } from '@prisma/client';

// Accounts module scaffolding — the menus that expose its screens.
//
// The account master is maintained as two screens, not one: GROUPS are the
// headings the statements roll up through and are never posted to, LEDGERS are
// what a voucher names. They are different work done by different people at
// different times, and a single screen made the 44 headings compete for
// attention with the 253 accounts.
// The two party masters lead: a control account (Sundry Debtors, Sundry
// Creditors) is only a total, and these are what it is a total OF. Without them
// the ledger cannot say whose balance moved.
export const ACCOUNTS_SUBS = [
  { name: 'Supplier Master', route: '/accounts/suppliers', icon: 'truck', order: 1 },
  { name: 'Customer Master', route: '/accounts/customers', icon: 'handshake', order: 2 },
  // The Annexure D master, seeded on boot; see CoaSeedService.
  {
    name: 'Account Groups',
    route: '/accounts/account-groups',
    icon: 'folder-tree',
    order: 3,
  },
  {
    name: 'Account Ledgers',
    route: '/accounts/account-ledgers',
    icon: 'book-open',
    order: 4,
  },
];

// Where the books are actually written. Its own main menu rather than a screen
// under Accounts Setup: setting up a chart and posting to it daily are
// different work, done by different people.
//
// One screen PER KIND rather than a single form with a type dropdown. Nobody
// sits down to "write a voucher" — they sit down to enter the day's cash
// receipts, or to pass a journal. The kind is settled before the form opens, so
// it belongs in the menu; it also lets each kind grow the fields it alone needs
// without those fields cluttering the other nine.
//
// Order follows how the money moves: cash, then bank, then the trading
// vouchers, then journal and contra, then the notes that correct them. Each
// screen's `code` (see VOUCHER_TYPES) is what its page passes to the shared
// form.
export const ACCOUNTS_VOUCHER_MENU = {
  name: 'Accounts Vouchers',
  icon: 'book-open-check',
  subs: [
    { name: 'Cash Receipt', route: '/accounts/vouchers/cash-receipt', icon: 'hand-coins', order: 1 },
    { name: 'Cash Payment', route: '/accounts/vouchers/cash-payment', icon: 'banknote', order: 2 },
    { name: 'Bank Receipt', route: '/accounts/vouchers/bank-receipt', icon: 'landmark', order: 3 },
    { name: 'Bank Payment', route: '/accounts/vouchers/bank-payment', icon: 'credit-card', order: 4 },
    { name: 'Purchase', route: '/accounts/vouchers/purchase', icon: 'shopping-cart', order: 5 },
    { name: 'Sales', route: '/accounts/vouchers/sales', icon: 'receipt', order: 6 },
    { name: 'Journal', route: '/accounts/vouchers/journal', icon: 'pencil-line', order: 7 },
    { name: 'Contra', route: '/accounts/vouchers/contra', icon: 'arrow-left-right', order: 8 },
    { name: 'Debit Note', route: '/accounts/vouchers/debit-note', icon: 'file-minus', order: 9 },
    { name: 'Credit Note', route: '/accounts/vouchers/credit-note', icon: 'file-plus', order: 10 },
  ],
};

// The Chart of Accounts itself is a REPORT — the master read as a statement
// would be, groups over sub-groups over ledgers, with print and export. It
// keeps the /accounts/chart-of-accounts route it has always had, so the
// privileges already granted on it follow it into this menu.
export const ACCOUNTS_REPORT_MENUS = [
  {
    name: 'Accounts Report',
    icon: 'bar-chart-3',
    subs: [
      {
        name: 'Chart of Accounts',
        route: '/accounts/chart-of-accounts',
        icon: 'list-tree',
        order: 1,
        objectType: ObjectType.REPORT,
      },
      // The headings on their own — the shape of the chart without the 253
      // accounts hanging off it, which is what you print to agree the
      // structure rather than the contents.
      {
        name: 'Account Groups',
        route: '/accounts/reports/account-groups',
        icon: 'network',
        order: 2,
        objectType: ObjectType.REPORT,
      },
    ],
  },
];
