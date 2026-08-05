'use client';

import { VoucherScreen } from '@/components/accounts/VoucherScreen';

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
    <VoucherScreen
      typeCode="SALES"
      route="/accounts/vouchers/sales"
      title="Sales Voucher"
      noun="sales voucher"
      icon="receipt"
      description="A sale booked against a customer — the customer is debited, sales credited"
    />
  );
}
