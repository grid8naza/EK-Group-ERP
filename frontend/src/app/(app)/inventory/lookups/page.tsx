'use client';

import { LookupsManager } from '@/components/lookups/LookupsManager';

// Inventory module reference lists. Super-admin only; isolated from other
// modules.
export default function InventoryLookupsPage() {
  return (
    <LookupsManager
      moduleCode="INVENTORY"
      route="/inventory/lookups"
      description="Manage Inventory reference lists and their values"
    />
  );
}
