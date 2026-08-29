'use client';

import { OrderCatalogueScreen } from '@/components/purchase/OrderCatalogueScreen';

/**
 * Order Catalogue — where a branch's regular inter-company order starts.
 *
 * Instead of naming products one line at a time on a blank ICPO, the branch is
 * shown everything the supplier sells: the picture, the price, what the branch
 * must keep, what it actually has, and how much to order. Ticking quantities and
 * pressing Create raises an ordinary ICPO draft, which opens on the ICPO screen
 * for a last look before it is submitted.
 */
export default function OrderCataloguePage() {
  return <OrderCatalogueScreen />;
}
