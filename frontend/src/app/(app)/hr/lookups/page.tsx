'use client';

import { LookupsManager } from '@/components/lookups/LookupsManager';

// HR module reference lists and their values. Super-admin only; isolated from
// other modules.
export default function HrLookupsPage() {
  return (
    <LookupsManager
      moduleCode="HR"
      route="/hr/lookups"
      description="Manage HR reference lists and their values"
    />
  );
}
