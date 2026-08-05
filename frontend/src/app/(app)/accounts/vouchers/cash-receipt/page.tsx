'use client';

import { VoucherScreen } from '@/components/accounts/VoucherScreen';

/**
 * Cash Receipt — Cash received in hand: a customer settling an invoice, an advance, a
 * refund. The cash account is debited and the source of the money credited.
 *
 * One kind per screen: the shared form is told which voucher it is writing and
 * never offers to change it.
 */
export default function CashReceiptPage() {
  return (
    <VoucherScreen
      typeCode="CASH_RECEIPT"
      route="/accounts/vouchers/cash-receipt"
      title="Cash Receipt"
      noun="cash receipt"
      icon="hand-coins"
      description="Money taken in over the counter — cash is debited, whoever paid is credited"
    />
  );
}
