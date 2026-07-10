'use client';

import { OpeningStockScreen } from '@/components/inventory/OpeningStockScreen';

export default function OpeningStockUnpackedProductsPage() {
  return (
    <OpeningStockScreen
      type="PRODUCT_UNPACKED"
      route="/inventory/opening-stock-unpacked-products"
      title="Opening Stock - Unpacked Products"
      noun="unpacked product"
    />
  );
}
