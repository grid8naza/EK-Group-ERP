'use client';

import { LookupsManager } from '@/components/lookups/LookupsManager';

// Accounts module reference lists and their values. Super-admin only, and
// isolated from other modules — except for the GLOBAL lists, which every
// module's Lookups screen can reach. Transaction Type and Transaction Subtype
// are two of those: the same taxonomy classifies a voucher and the stock
// document behind it, so it belongs to no one module.
export default function AccountsLookupsPage() {
  return (
    <LookupsManager
      moduleCode="ACCOUNTS"
      route="/accounts/lookups"
      description="Manage Accounts reference lists and their values"
    />
  );
}
