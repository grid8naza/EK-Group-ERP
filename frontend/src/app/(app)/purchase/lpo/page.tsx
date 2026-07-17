'use client';

import { LocalPurchaseOrderScreen } from '@/components/purchase/LocalPurchaseOrderScreen';

/**
 * LPO — Local Purchase Order (Purchase module): orders the active company raised
 * on an EXTERNAL supplier from the Accounts Supplier Master, from draft through
 * the buyer's own approval workflow.
 *
 * Unlike the ICPO there is no second side — an external supplier never logs in —
 * and lines carry a rate, so approval routes on the order's value.
 */
export default function LpoPage() {
  return <LocalPurchaseOrderScreen />;
}
