'use client';

import { JournalVoucherScreen } from '@/components/accounts/JournalVoucherScreen';

/**
 * Journal Voucher — The entry for everything that changes the books without money changing
 * hands: depreciation booked by hand, an accrual, a misposting moved from one
 * head to another.
 *
 * The first of the ten kinds to be given its own form rather than the shared
 * one: a journal is entered as a journal is written — Dr and Cr lines down the
 * page, each with its own narration, the two columns totalled at the foot.
 */
export default function JournalVoucherPage() {
  return (
    <JournalVoucherScreen
      typeCode="JOURNAL"
      route="/accounts/vouchers/journal"
      title="Journal Voucher"
      noun="journal voucher"
      icon="pencil-line"
      description="An entry that moves no money — accruals, provisions, corrections, transfers between heads"
    />
  );
}
