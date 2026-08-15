import { ObjectType } from '@prisma/client';

// Purchase module screens — everything the company BUYS, split by counterparty:
//  - ICPO (Inter-Company Purchase Order): raised on another GROUP company. Its
//    counterparty is a Company, its lines are that company's sellable Products,
//    and it carries no price. The supplier company's view of the same row is
//    "ICPO - Received" over in CRM. Served by modules/crm's PurchaseOrderService.
//  - LPO (Local Purchase Order): raised on an EXTERNAL supplier from the Accounts
//    Supplier Master. Its counterparty is a Supplier, its lines are Items or
//    Products bought at a rate, and it has no second side — an external supplier
//    never logs in. Served by this module's LpoService.
//
// A provisioning file declares menus, not code ownership, which is why the ICPO
// screen is listed here while its service lives in modules/crm (cf.
// accounts-provisioning in modules/supplier).
//
// Names stay SHORT because they label the sidebar (cf. the Inventory
// Transactions → Vouchers rename, done because the label wrapped); the full
// expansions live in each screen's page header.
export const PURCHASE_SUBS = [
  {
    name: 'ICPO',
    route: '/purchase/icpo',
    icon: 'shopping-cart',
    order: 1,
    tabs: [
      { key: 'order', label: 'Purchase Order', order: 1 },
      { key: 'stock', label: 'Stock & acceptance', order: 2 },
    ],
  },
  { name: 'LPO', route: '/purchase/lpo', icon: 'truck', order: 2 },
];

// A second main menu for what was actually BOUGHT, as opposed to what was
// ordered above.
//
// The register is read off the goods receipts, not off a purchase expense
// account: a receipt debits inventory and the cost reaches the profit and loss
// when the material is consumed, so no ledger balance can answer "what did we
// buy from whom, at what rate" — only the document can, and it answers with the
// supplier, item, batch and store as well.
export const PURCHASE_REPORT_MENUS = [
  {
    name: 'Purchase Report',
    icon: 'bar-chart-3',
    subs: [
      {
        name: 'Purchase Register',
        route: '/purchase/reports/purchase-register',
        icon: 'receipt',
        order: 1,
        objectType: ObjectType.REPORT,
      },
    ],
  },
];
