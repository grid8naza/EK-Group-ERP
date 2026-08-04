'use client';

import { VoucherScreen } from '@/components/accounts/VoucherScreen';

/**
 * Voucher Entry — the general ledger's write side: journal, payment, receipt
 * and contra vouchers raised by hand.
 *
 * A sale or a payroll run posts its own voucher from the module that owns the
 * event, so those kinds are not offered here.
 */
export default function VouchersPage() {
  return <VoucherScreen />;
}
