'use client';

import { SalesOrderScreen } from '@/components/crm/SalesOrderScreen';

/**
 * ICSO — Inter-Company Sales Order (CRM): the selling company's order to supply
 * another group company, converted from their approved ICPO under
 * "ICPO - Received". No New button: an ICSO only ever comes from a purchase
 * order, and what's decided here is the QUANTITY we commit to.
 *
 * An LSO (Local Sales Order, raised on an external customer) joins this module
 * once the Customer master exists.
 */
export default function IcsoPage() {
  return <SalesOrderScreen />;
}
