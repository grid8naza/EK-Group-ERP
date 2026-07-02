'use client';

import { LookupsManager } from '@/components/lookups/LookupsManager';

// Cpanel-scoped reference lists (e.g. Developers, Icons). Each module manages
// its own lookups from its own Lookups screen; this one is isolated to Cpanel.
export default function CpanelLookupsPage() {
  return (
    <LookupsManager
      moduleCode="CPANEL"
      route="/cpanel/lookups"
      description="Manage Cpanel reference lists and their values"
    />
  );
}
