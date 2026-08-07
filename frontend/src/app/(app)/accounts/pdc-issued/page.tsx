'use client';

import { PdcRegister } from '@/components/accounts/PdcRegister';

/**
 * Post-dated cheques this company WROTE — what is about to leave the bank.
 *
 * Its own screen rather than half of one, because nobody asks the question both
 * ways at once. This is the one you open to know what the account has to carry
 * over the next fortnight; the received register answers a different worry
 * entirely.
 */
export default function PdcIssuedPage() {
  return (
    <PdcRegister
      side="ISSUED"
      route="/accounts/pdc-issued"
      title="PDC Issued"
      description="Post-dated cheques written and not yet presented — what is still to leave the bank"
    />
  );
}
