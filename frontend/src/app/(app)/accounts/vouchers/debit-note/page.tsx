'use client';

import { VoucherScreen } from '@/components/accounts/VoucherScreen';

/**
 * Debit Note — What the company owes a supplier, reduced: goods sent back, a shortage, a
 * price agreed down after the bill. The supplier is debited and the purchase
 * (or the return account) credited.
 *
 * One kind per screen: the shared form is told which voucher it is writing and
 * never offers to change it.
 */
export default function DebitNotePage() {
  return (
    <VoucherScreen
      typeCode="DEBIT_NOTE"
      route="/accounts/vouchers/debit-note"
      title="Debit Note"
      noun="debit note"
      icon="file-minus"
      description="A charge raised against a supplier — goods returned, a short delivery, an overcharge"
    />
  );
}
