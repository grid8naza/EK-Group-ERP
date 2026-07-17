// CRM module screens — the supplier company's side of an intercompany order.
//
// An ICPO is ONE row seen from two sides. The buyer raises it in the PURCHASE
// module (see purchase-provisioning); the supplier company sees that same row
// here, because incoming demand is what CRM handles. Read + act only — a
// supplier never raises the buyer's order.
//
// This module's PurchaseOrderService serves BOTH sides: a provisioning file
// declares menus, not code ownership.
export const CRM_SUBS = [
  { name: 'ICPO - Received', route: '/crm/icpo-received', icon: 'inbox', order: 1 },
  { name: 'Sales Orders', route: '/crm/sales-orders', icon: 'clipboard-list', order: 2 },
];
