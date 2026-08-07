'use client';

import { VoucherEntryScreen } from '@/components/accounts/VoucherEntryScreen';

/**
 * Debit Note — a party's balance, charged. Usually a supplier: goods sent back,
 * a shortage, a price agreed down after the bill. Sometimes a customer, where
 * the charge is one raised on THEM. Either way the party is debited and
 * whatever gave rise to it credited — the mirror of the credit note.
 *
 * One kind per screen: the shared form is told which voucher it is writing and
 * never offers to change it.
 */
export default function DebitNotePage() {
  return (
    <VoucherEntryScreen
      typeCode="DEBIT_NOTE"
      route="/accounts/vouchers/debit-note"
      title="Debit Note"
      noun="debit note"
      icon="file-minus"
      description="A charge raised against a supplier — goods returned, a short delivery, an overcharge"
      // A debit note debits somebody, whichever side they are on: the first
      // line is locked to Dr and its ledger picker offers the control accounts
      // aged by either party, so naming the ledger settles whether this is
      // raised on a supplier or on a customer.
      firstLine={{ side: 'DR', party: ['SUPPLIER', 'CUSTOMER'] }}
    />
  );
}
