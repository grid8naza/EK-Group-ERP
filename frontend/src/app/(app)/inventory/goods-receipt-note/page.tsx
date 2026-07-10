'use client';

import { StockTransactionScreen } from '@/components/inventory/StockTransactionScreen';

export default function GoodsReceiptNotePage() {
  return (
    <StockTransactionScreen
      type="PURCHASE"
      inbound
      route="/inventory/goods-receipt-note"
      title="Goods Receipt Note"
      noun="goods receipt"
    />
  );
}
