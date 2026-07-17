'use client';

import { PurchaseOrderScreen } from '@/components/crm/PurchaseOrderScreen';

/**
 * ICPO - Received (CRM): the supplier company's view of an Inter-Company
 * Purchase Order another group company raised on the active company. Read-only
 * apart from acting on the approval workflow. Drafts never appear here; they
 * don't exist outside the buyer.
 */
export default function IcpoReceivedPage() {
  return <PurchaseOrderScreen scope="received" />;
}
