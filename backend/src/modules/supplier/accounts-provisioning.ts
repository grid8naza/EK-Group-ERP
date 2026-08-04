import { ObjectType } from '@prisma/client';

// Accounts module scaffolding — the menus that expose its screens.
//
// The account master is maintained as two screens, not one: GROUPS are the
// headings the statements roll up through and are never posted to, LEDGERS are
// what a voucher names. They are different work done by different people at
// different times, and a single screen made the 44 headings compete for
// attention with the 253 accounts.
export const ACCOUNTS_SUBS = [
  { name: 'Supplier Master', route: '/accounts/suppliers', icon: 'truck', order: 1 },
  // The Annexure D master, seeded on boot; see CoaSeedService.
  {
    name: 'Account Groups',
    route: '/accounts/account-groups',
    icon: 'folder-tree',
    order: 2,
  },
  {
    name: 'Account Ledgers',
    route: '/accounts/account-ledgers',
    icon: 'book-open',
    order: 3,
  },
];

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
    ],
  },
];
