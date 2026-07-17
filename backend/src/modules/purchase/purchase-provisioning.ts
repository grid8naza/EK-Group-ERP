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
  { name: 'ICPO', route: '/purchase/icpo', icon: 'shopping-cart', order: 1 },
  { name: 'LPO', route: '/purchase/lpo', icon: 'truck', order: 2 },
];
