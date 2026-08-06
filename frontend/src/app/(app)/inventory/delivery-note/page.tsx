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
      // Who the goods went to, and the tax charged on them: a delivery note is
      // the sale, and the sales register is read off it.
      showCustomer
      showClassification
      showTax
    />
  );
}
