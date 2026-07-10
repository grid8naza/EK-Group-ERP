'use client';

import { StockTransactionScreen } from '@/components/inventory/StockTransactionScreen';

export default function PurchaseReturnPage() {
  return (
    <StockTransactionScreen
      type="PURCHASE_RETURN"
      inbound={false}
      route="/inventory/purchase-return"
      title="Purchase Return"
      noun="purchase return"
    />
  );
}
