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
      // The first line is the supplier being credited: a payable ledger, so the
      // sub-ledger beside it offers the suppliers kept under that account.
      firstLine={{ side: 'CR', party: 'SUPPLIER' }}
      // Always a purchase — the menu said so. Which KIND of purchase is the one
      // thing the lines cannot say, so that is the one thing asked.
      transaction={{ type: 'Purchase', askSubtype: true }}
    />
  );
}
