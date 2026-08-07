'use client';

import { VoucherEntryScreen } from '@/components/accounts/VoucherEntryScreen';

/**
 * Contra Voucher — Cash deposited into the bank, or drawn out of it. Both sides are the
 * company’s own money, so nothing is earned or spent — which is why it is
 * kept off the receipt and payment books entirely.
 *
 * One kind per screen: the shared form is told which voucher it is writing and
 * never offers to change it.
 */
export default function ContraVoucherPage() {
  return (
    <VoucherEntryScreen
      typeCode="CONTRA"
      route="/accounts/vouchers/contra"
      title="Contra Voucher"
      noun="contra voucher"
      icon="arrow-left-right"
      description="Money moved between the company's own cash and bank accounts"
      // Both sides are the company's own money, so every line is a cash or a
      // bank account and an ordinary ledger has no business on either. Which
      // way round is left open: a contra is a deposit or a withdrawal, and the
      // form should not decide which one is being written.
      lines={{ money: ['CASH', 'BANK'] }}
    />
  );
}
