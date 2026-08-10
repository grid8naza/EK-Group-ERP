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
      // The first line is the money leaving, so it is always a credit. WHICH
      // ledger follows from the instrument rather than from here: the bank on
      // an ordinary payment, a post-dated cheque ledger on a PDC.
      firstLine={{ side: 'CR' }}
      // Mode, bank, number and date — and, on a cheque, whether it is due now
      // or later.
      askInstrument
      // The two pieces of paper a payment out of the bank produces: the advice
      // the payee is sent, and — where it went by cheque — the leaf itself.
      // Both take the bank's own details from the ledger the money left.
      documents={['ADVICE', 'CHEQUE']}
    />
  );
}
