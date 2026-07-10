'use client';

import { StockTransactionScreen } from '@/components/inventory/StockTransactionScreen';

export default function GoodsIssueNotePage() {
  return (
    <StockTransactionScreen
      type="CONSUMPTION"
      inbound={false}
      route="/inventory/goods-issue-note"
      title="Goods Issue Note (Consumption)"
      noun="goods issue"
    />
  );
}
