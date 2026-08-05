'use client';

import { VoucherScreen } from '@/components/accounts/VoucherScreen';

/**
 * Cash Payment — Cash paid out of hand: wages, a supplier settled in notes, petty expenses.
 * The cash account is credited and whatever the money went on debited.
 *
 * One kind per screen: the shared form is told which voucher it is writing and
 * never offers to change it.
 */
export default function CashPaymentPage() {
  return (
    <VoucherScreen
      typeCode="CASH_PAYMENT"
      route="/accounts/vouchers/cash-payment"
      title="Cash Payment"
      noun="cash payment"
      icon="banknote"
      description="Money paid out in cash — cash is credited, what it was spent on is debited"
    />
  );
}
