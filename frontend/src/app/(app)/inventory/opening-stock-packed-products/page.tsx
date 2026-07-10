'use client';

import { OpeningStockScreen } from '@/components/inventory/OpeningStockScreen';

export default function OpeningStockPackedProductsPage() {
  return (
    <OpeningStockScreen
      type="PRODUCT_PACKED"
      route="/inventory/opening-stock-packed-products"
      title="Opening Stock - Packed Products"
      noun="packed product"
    />
  );
}
