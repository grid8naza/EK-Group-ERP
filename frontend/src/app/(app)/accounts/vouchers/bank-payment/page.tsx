'use client';

import { VoucherScreen } from '@/components/accounts/VoucherScreen';

/**
 * Bank Payment — Money leaving the bank: a cheque written, a transfer sent, bank charges
 * taken. The bank account is credited and the expense or supplier debited.
 *
 * One kind per screen: the shared form is told which voucher it is writing and
 * never offers to change it.
 */
export default function BankPaymentPage() {
  return (
    <VoucherScreen
      typeCode="BANK_PAYMENT"
      route="/accounts/vouchers/bank-payment"
      title="Bank Payment"
      noun="bank payment"
      icon="credit-card"
      description="Money paid out of the bank — cheques, transfers, standing charges"
    />
  );
}
