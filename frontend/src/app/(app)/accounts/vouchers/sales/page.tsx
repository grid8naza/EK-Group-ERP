'use client';

import { VoucherEntryScreen } from '@/components/accounts/VoucherEntryScreen';

/**
 * Sales Voucher — A sale recorded when the customer is invoiced rather than when they pay.
 * The receipt that settles it is a separate voucher against the same
 * customer account.
 *
 * One kind per screen: the shared form is told which voucher it is writing and
 * never offers to change it.
 */
export default function SalesVoucherPage() {
  return (
    <VoucherEntryScreen
      typeCode="SALES"
      route="/accounts/vouchers/sales"
      title="Sales Voucher"
      noun="sales voucher"
      icon="receipt"
      description="A sale booked against a customer — the customer is debited, sales credited"
      // The invoice will raise this voucher and say what kind of sale it was —
      // both the type and the subtype. Shown so a generated one can be read,
      // and asked for by neither; see the purchase voucher for the shape that
      // fixes a type and asks for its subtype.
      transaction={{}}
    />
  );
}
