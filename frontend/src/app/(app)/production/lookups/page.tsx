'use client';

import { LookupsManager } from '@/components/lookups/LookupsManager';

// Production module reference lists. Super-admin only; isolated from other
// modules.
export default function ProductionLookupsPage() {
  return (
    <LookupsManager
      moduleCode="PRODUCTION"
      route="/production/lookups"
      description="Manage Production reference lists and their values"
    />
  );
}
