'use client';

import { OpeningStockScreen } from '@/components/inventory/OpeningStockScreen';

export default function OpeningStockRawMaterialPage() {
  return (
    <OpeningStockScreen
      type="ITEM_RAW"
      route="/inventory/opening-stock-raw-material"
      title="Opening Stock - Raw Material"
      noun="raw material"
    />
  );
}
