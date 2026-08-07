'use client';

import { VoucherEntryScreen } from '@/components/accounts/VoucherEntryScreen';

/**
 * Journal Voucher — The entry for everything that changes the books without money changing
 * hands: depreciation booked by hand, an accrual, a misposting moved from one
 * head to another.
 *
 * The form was written for this kind first — Dr and Cr lines down the page,
 * each with its own narration, the two columns totalled at the foot — and then
 * given to every other kind but the two bank ones, because that is how all of
 * them are written.
 */
export default function JournalVoucherPage() {
  return (
    <VoucherEntryScreen
      typeCode="JOURNAL"
      route="/accounts/vouchers/journal"
      title="Journal Voucher"
      noun="journal voucher"
      icon="pencil-line"
      description="An entry that moves no money — accruals, provisions, corrections, transfers between heads"
    />
  );
}
