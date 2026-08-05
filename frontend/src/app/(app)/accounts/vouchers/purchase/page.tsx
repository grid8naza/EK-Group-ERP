'use client';

import { VoucherScreen } from '@/components/accounts/VoucherScreen';

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
    <VoucherScreen
      typeCode="PURCHASE"
      route="/accounts/vouchers/purchase"
      title="Purchase Voucher"
      noun="purchase voucher"
      icon="shopping-cart"
      description="A purchase booked against a supplier — what was bought is debited, the supplier credited"
    />
  );
}
