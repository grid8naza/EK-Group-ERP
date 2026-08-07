'use client';

import { VoucherEntryScreen } from '@/components/accounts/VoucherEntryScreen';

/**
 * Cash Receipt — Cash received in hand: a customer settling an invoice, an advance, a
 * refund. The cash account is debited and the source of the money credited.
 *
 * One kind per screen: the shared form is told which voucher it is writing and
 * never offers to change it.
 */
export default function CashReceiptPage() {
  return (
    <VoucherEntryScreen
      typeCode="CASH_RECEIPT"
      route="/accounts/vouchers/cash-receipt"
      title="Cash Receipt"
      noun="cash receipt"
      icon="hand-coins"
      description="Money taken in over the counter — cash is debited, whoever paid is credited"
      // The first line IS the receipt: cash coming in, so a debit, and to a
      // cash account rather than any of the two hundred others. Settled by the
      // menu the user came through, not asked again on every entry.
      firstLine={{ side: 'DR', money: 'CASH' }}
    />
  );
}
