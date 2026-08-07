'use client';

import { VoucherEntryScreen } from '@/components/accounts/VoucherEntryScreen';

/**
 * Credit Note — a party's balance, reduced. Usually a customer: a return
 * accepted, a discount allowed after the invoice went out, an error in their
 * favour. Sometimes a supplier, where the credit is the one they have allowed
 * US. Either way the party is credited and whatever gave rise to it debited.
 *
 * One kind per screen: the shared form is told which voucher it is writing and
 * never offers to change it.
 */
export default function CreditNotePage() {
  return (
    <VoucherEntryScreen
      typeCode="CREDIT_NOTE"
      route="/accounts/vouchers/credit-note"
      title="Credit Note"
      noun="credit note"
      icon="file-plus"
      description="A credit allowed to a customer — goods returned, a discount given after invoicing"
      // A credit note credits somebody, whichever side they are on: the first
      // line is locked to Cr and its ledger picker offers the control accounts
      // aged by either party, so naming the ledger settles whether this is a
      // customer's credit or a supplier's.
      firstLine={{ side: 'CR', party: ['SUPPLIER', 'CUSTOMER'] }}
    />
  );
}
