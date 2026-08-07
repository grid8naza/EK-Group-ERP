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
    />
  );
}
