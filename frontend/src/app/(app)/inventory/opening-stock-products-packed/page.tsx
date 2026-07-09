'use client';

import { OpeningStockScreen } from '@/components/inventory/OpeningStockScreen';

export default function OpeningStockProductsPackedPage() {
  return (
    <OpeningStockScreen
      type="PRODUCT_PACKED"
      route="/inventory/opening-stock-products-packed"
      title="Opening Stock - Products (Packed)"
      noun="packed product"
    />
  );
}
