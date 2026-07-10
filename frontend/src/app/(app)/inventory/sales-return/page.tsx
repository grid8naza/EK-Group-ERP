'use client';

import { StockTransactionScreen } from '@/components/inventory/StockTransactionScreen';

export default function SalesReturnPage() {
  return (
    <StockTransactionScreen
      type="SALES_RETURN"
      inbound
      route="/inventory/sales-return"
      title="Sales Return"
      noun="sales return"
    />
  );
}
