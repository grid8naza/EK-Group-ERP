'use client';

import { VoucherEntryScreen } from '@/components/accounts/VoucherEntryScreen';

/**
 * Bank Payment — Money leaving the bank: a cheque written, a transfer sent,
 * bank charges taken.
 *
 * The one kind where HOW the money moved is a fact worth keeping. A cash
 * payment is notes and there is nothing more to say; this one goes by cheque,
 * by transfer, by card, and the number and date on the instrument are what
 * anyone reconciling a statement matches against.
 *
 * A post-dated cheque is the reason for most of that. It pays the party the day
 * it is handed over, but the bank knows nothing about it until the leaf is
 * presented — so it is credited to Post-dated Cheques Issued, and the bank is
 * credited later from the PDC Register, on the day it actually clears.
 */
export default function BankPaymentPage() {
  return (
    <VoucherEntryScreen
      typeCode="BANK_PAYMENT"
      route="/accounts/vouchers/bank-payment"
      title="Bank Payment"
      noun="bank payment"
      icon="credit-card"
      description="Money paid out of the bank — cheques, transfers, standing charges"
      // The first line is the money leaving. A bank account on an ordinary
      // payment; on a post-dated cheque it is the holding account instead, so
      // the picker offers both and the instrument block says which is right.
      firstLine={{ side: 'CR' }}
      // Mode, bank, number and date — and, on a cheque, whether it is due now
      // or later.
      askInstrument
    />
  );
}
