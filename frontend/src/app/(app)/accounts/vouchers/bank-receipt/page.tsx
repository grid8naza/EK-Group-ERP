'use client';

import { VoucherEntryScreen } from '@/components/accounts/VoucherEntryScreen';

/**
 * Bank Receipt — Money reaching the bank: a customer's cheque banked, a transfer
 * received, a card settlement.
 *
 * The mirror of the bank payment, with one fact it does not have: whose bank the
 * cheque was drawn on. A cheque this company writes is drawn on its own bank,
 * already named; one it is handed was written by somebody else on theirs, and
 * that is what a returned cheque is traced back along.
 *
 * A post-dated cheque taken in is held the same way, from the other side: it is
 * an asset rather than a liability — somebody's promise to pay us — and it sits
 * in a Post-dated Cheques Received ledger until the day it clears, when the PDC
 * Register moves it into the bank.
 */
export default function BankReceiptPage() {
  return (
    <VoucherEntryScreen
      typeCode="BANK_RECEIPT"
      route="/accounts/vouchers/bank-receipt"
      title="Bank Receipt"
      noun="bank receipt"
      icon="landmark"
      description="Money received into the bank — transfers, cheques banked, card settlements"
      // The first line is the money arriving, so always a debit. WHICH ledger
      // follows from the instrument: the bank on an ordinary receipt, a
      // post-dated cheque ledger on a PDC.
      firstLine={{ side: 'DR' }}
      // Mode, bank, number and date — plus the issuer bank, which only a
      // receipt asks for.
      askInstrument
    />
  );
}
