// CRM module screens. A requester (an intercompany branch) places sales orders
// on a supplier company via "Place Order"; the supplier's CRM staff process the
// incoming orders under "Sales Orders". Registered in the module scaffold.
export const CRM_SUBS = [
  { name: 'Purchase Order - IC', route: '/crm/purchase-orders-ic', icon: 'shopping-cart', order: 1 },
  { name: 'Sales Orders', route: '/crm/sales-orders', icon: 'clipboard-list', order: 2 },
];
