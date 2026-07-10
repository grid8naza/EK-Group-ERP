'use client';

import { OpeningStockScreen } from '@/components/inventory/OpeningStockScreen';

export default function OpeningStockPackingMaterialPage() {
  return (
    <OpeningStockScreen
      type="ITEM_PACKING"
      route="/inventory/opening-stock-packing-material"
      title="Opening Stock - Packing Material"
      noun="packing material"
    />
  );
}
