'use client';

import { PurchaseOrderScreen } from '@/components/crm/PurchaseOrderScreen';

/**
 * ICPO — Inter-Company Purchase Order (Purchase module): the buyer's view.
 * Orders the active company raised on another GROUP company, from draft through
 * the approval workflow. The workflow binds to this screen because a PO is
 * matched to its definition at its origin — the buyer. The supplier company's
 * view of the same row is "ICPO - Received", over in CRM.
 *
 * Orders raised on an EXTERNAL supplier are a Local Purchase Order (LPO) — its
 * counterparty is a Supplier from the Accounts master rather than a Company.
 * That's a separate screen in this module, not yet built.
 */
export default function IcpoPage() {
  return <PurchaseOrderScreen scope="sent" />;
}
