'use client';

import { VoucherScreen } from '@/components/accounts/VoucherScreen';

/**
 * Credit Note — What a customer owes, reduced: a return accepted, a discount allowed after
 * the invoice went out, an error in their favour. The customer is credited
 * and sales (or the return account) debited.
 *
 * One kind per screen: the shared form is told which voucher it is writing and
 * never offers to change it.
 */
export default function CreditNotePage() {
  return (
    <VoucherScreen
      typeCode="CREDIT_NOTE"
      route="/accounts/vouchers/credit-note"
      title="Credit Note"
      noun="credit note"
      icon="file-plus"
      description="A credit allowed to a customer — goods returned, a discount given after invoicing"
    />
  );
}
