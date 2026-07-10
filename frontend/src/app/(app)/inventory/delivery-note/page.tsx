'use client';

import { StockTransactionScreen } from '@/components/inventory/StockTransactionScreen';

export default function DeliveryNotePage() {
  return (
    <StockTransactionScreen
      type="SALE"
      inbound={false}
      route="/inventory/delivery-note"
      title="Delivery Note"
      noun="delivery"
    />
  );
}
