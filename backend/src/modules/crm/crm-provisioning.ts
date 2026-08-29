import { ObjectType } from '@prisma/client';

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
  {
    name: 'ICPO - Received',
    route: '/crm/icpo-received',
    icon: 'inbox',
    order: 1,
    // Same two panes as the buyer's ICPO screen — they are one component.
    tabs: [
      { key: 'order', label: 'Purchase Order', order: 1 },
      { key: 'stock', label: 'Stock & acceptance', order: 2 },
    ],
  },
  { name: 'ICSO', route: '/crm/icso', icon: 'clipboard-list', order: 2 },
  // LSO — an OUTSIDE customer ordering from a branch, as opposed to the ICSO's
  // group company. Shares the sales-order table; told apart by which
  // counterparty is set, and kept on its own screen because almost nothing else
  // about the two is the same.
  { name: 'LSO', route: '/crm/lso', icon: 'shopping-bag', order: 3 },
  // Dispatch — ship an approved sales order; invoice + delivery note + e-way bill.
  { name: 'Dispatch', route: '/crm/dispatch', icon: 'truck', order: 4 },
  // Sales Invoice — the GST bill, raised against a delivery note. One per
  // delivery, which is how a contract customer is billed: the note says what
  // actually went out, and the bill charges for that.
  { name: 'Sales Invoice', route: '/crm/invoices', icon: 'receipt-indian-rupee', order: 5 },
  // Contracts — the standing agreements behind institutional customers. Not an
  // order: the agreement says what goes out on which days at what price, and
  // each day's obligation is derived from it rather than raised.
  { name: 'Contracts', route: '/crm/contracts', icon: 'file-signature', order: 6 },
];

// A second main menu for what was actually SOLD, as opposed to what was ordered
// above.
//
// The register is read off the documents that moved the goods — a Delivery Note
// to a customer, an intercompany Dispatch to another group company — for the
// same reason the purchase one is: a sale is a document, and a ledger balance
// could only ever give a total.
export const CRM_REPORT_MENUS = [
  {
    name: 'Sales Report',
    icon: 'bar-chart-3',
    subs: [
      {
        name: 'Sales Register',
        route: '/crm/reports/sales-register',
        icon: 'receipt-text',
        order: 1,
        objectType: ObjectType.REPORT,
      },
    ],
  },
];
