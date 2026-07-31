'use client';

import { StockTransactionScreen } from '@/components/inventory/StockTransactionScreen';

export default function GoodsIssueNotePage() {
  return (
    <StockTransactionScreen
      type="CONSUMPTION"
      inbound={false}
      route="/inventory/goods-issue-note"
      title="Goods Issue Note"
      noun="goods issue"
      // Raw-material items carry no costing of their own, so an ad-hoc issue
      // has nothing to inherit — the header says what it is for. Issues raised
      // through a Material Request take the requisition's instead.
      showCosting
    />
  );
}
