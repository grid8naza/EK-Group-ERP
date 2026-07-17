// CRM module screens — the supplier/seller's side of the intercompany flow.
//
// An ICPO is ONE row seen from two sides. The buyer raises it in the PURCHASE
// module (see purchase-provisioning); the supplier company sees that same row
// here as "ICPO - Received", because incoming demand is what CRM handles. Read +
// act only — a supplier never raises the buyer's order.
//
// Once an ICPO is approved, the supplier's CRM staff CONVERT it into an ICSO
// (Inter-Company Sales Order) — their own order to supply, with the quantities
// they commit to. Conversion is deliberate, not automatic: the quantity check is
// the point, and an auto-created order nobody has looked at defeats it.
//
// An LSO (Local Sales Order, raised on an external customer) will sit beside the
// ICSO once the Customer master exists.
//
// This module's PurchaseOrderService serves both sides of the ICPO; its
// SalesOrderService owns the ICSO. A provisioning file declares menus, not code
// ownership.
export const CRM_SUBS = [
  { name: 'ICPO - Received', route: '/crm/icpo-received', icon: 'inbox', order: 1 },
  { name: 'ICSO', route: '/crm/icso', icon: 'clipboard-list', order: 2 },
];
