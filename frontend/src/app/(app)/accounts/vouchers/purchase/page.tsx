'use client';

import { VoucherEntryScreen } from '@/components/accounts/VoucherEntryScreen';

/**
 * Purchase Voucher — A purchase recorded when the supplier is billed rather than when they are
 * paid. Nothing moves in cash or bank here — the payment is a separate
 * voucher later, against the same supplier account.
 *
 * One kind per screen: the shared form is told which voucher it is writing and
 * never offers to change it.
 */
export default function PurchaseVoucherPage() {
  return (
    <VoucherEntryScreen
      typeCode="PURCHASE"
      route="/accounts/vouchers/purchase"
      title="Purchase Voucher"
      noun="purchase voucher"
      icon="shopping-cart"
      description="A purchase booked against a supplier — what was bought is debited, the supplier credited"
      // The supplier's bill will raise this voucher and say what kind of
      // purchase it was. Shown so a generated one can be read; disabled so
      // nobody answers it twice.
      showTransaction
    />
  );
}
