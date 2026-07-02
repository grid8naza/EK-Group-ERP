'use client';

import { LookupsManager } from '@/components/lookups/LookupsManager';

// Asset module reference lists (e.g. Asset Brands, which backs the Asset
// Master's Brand dropdown). Super-admin only; isolated from other modules.
export default function AssetLookupsPage() {
  return (
    <LookupsManager
      moduleCode="ASSET"
      route="/asset/lookups"
      description="Manage Asset reference lists (brands, etc.) and their values"
    />
  );
}
