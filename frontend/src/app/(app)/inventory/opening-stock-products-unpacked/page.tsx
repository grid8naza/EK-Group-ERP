'use client';

import { OpeningStockScreen } from '@/components/inventory/OpeningStockScreen';

export default function OpeningStockProductsUnpackedPage() {
  return (
    <OpeningStockScreen
      type="PRODUCT_UNPACKED"
      route="/inventory/opening-stock-products-unpacked"
      title="Opening Stock - Products (Unpacked)"
      noun="unpacked product"
    />
  );
}
