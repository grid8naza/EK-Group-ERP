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
      // The mirror of the purchase voucher. The first line is the customer
      // being debited: a receivable ledger, so the sub-ledger beside it offers
      // the customers kept under that account.
      firstLine={{ side: 'DR', party: 'CUSTOMER' }}
      // Always a sale — the menu said so. Which KIND of sale is the one thing
      // the lines cannot say, so that is the one thing asked.
      transaction={{ type: 'Sale', askSubtype: true }}
    />
  );
}
