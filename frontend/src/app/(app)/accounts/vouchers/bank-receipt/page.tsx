'use client';

import { VoucherScreen } from '@/components/accounts/VoucherScreen';

/**
 * Bank Receipt — Money that landed in the bank rather than the till. Kept apart from a cash
 * receipt because the bank account is reconciled against a statement and the
 * cash account is counted.
 *
 * One kind per screen: the shared form is told which voucher it is writing and
 * never offers to change it.
 */
export default function BankReceiptPage() {
  return (
    <VoucherScreen
      typeCode="BANK_RECEIPT"
      route="/accounts/vouchers/bank-receipt"
      title="Bank Receipt"
      noun="bank receipt"
      icon="landmark"
      description="Money received into the bank — transfers, cheques banked, card settlements"
    />
  );
}
