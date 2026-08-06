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
      showSupplier
      showClassification
      // The rate is back on the receipt, and tax needs it: GST is charged on
      // what the goods cost, and without a rate a receipt banks stock at nil —
      // which is also what the purchase register would then report.
      showTax
      // Intercompany shipments are received here too: pick the dispatch and the
      // goods it carried are banked into this company's store.
      showIncomingDispatch
    />
  );
}
