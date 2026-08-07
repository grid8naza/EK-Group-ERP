'use client';

import { PdcRegister } from '@/components/accounts/PdcRegister';

/**
 * Post-dated cheques this company was GIVEN — money promised and not yet had.
 *
 * The longer of the two lives: a cheque taken in waits, goes to the bank, comes
 * back unpaid, goes again. This is where somebody chasing a customer's money
 * finds out which of those it is doing.
 */
export default function PdcReceivedPage() {
  return (
    <PdcRegister
      side="RECEIVED"
      route="/accounts/pdc-received"
      title="PDC Received"
      description="Post-dated cheques taken in — in hand, banked, cleared, or come back"
    />
  );
}
