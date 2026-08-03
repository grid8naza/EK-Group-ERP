// Accounts module scaffolding — the menu that exposes its screens. Kept minimal
// for now (Supplier Master); more finance screens are added here later.

export const ACCOUNTS_SUBS = [
  { name: 'Supplier Master', route: '/accounts/suppliers', icon: 'truck', order: 1 },
  // The account master from Annexure D — the group-level Chart of Accounts and
  // which of it each company has adopted. Seeded on boot; see CoaSeedService.
  {
    name: 'Chart of Accounts',
    route: '/accounts/chart-of-accounts',
    icon: 'book-open',
    order: 2,
  },
];
