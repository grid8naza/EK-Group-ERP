'use client';

import { OpeningStockScreen } from '@/components/inventory/OpeningStockScreen';

export default function OpeningStockItemsPage() {
  return (
    <OpeningStockScreen
      type="ITEM"
      route="/inventory/opening-stock-items"
      title="Opening Stock - Items"
      noun="item"
    />
  );
}
