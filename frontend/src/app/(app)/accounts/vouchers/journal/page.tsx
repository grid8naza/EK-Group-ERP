'use client';

import { VoucherScreen } from '@/components/accounts/VoucherScreen';

/**
 * Journal Voucher — The entry for everything that changes the books without money changing
 * hands: depreciation booked by hand, an accrual, a misposting moved from one
 * head to another.
 *
 * One kind per screen: the shared form is told which voucher it is writing and
 * never offers to change it.
 */
export default function JournalVoucherPage() {
  return (
    <VoucherScreen
      typeCode="JOURNAL"
      route="/accounts/vouchers/journal"
      title="Journal Voucher"
      noun="journal voucher"
      icon="pencil-line"
      description="An entry that moves no money — accruals, provisions, corrections, transfers between heads"
    />
  );
}
