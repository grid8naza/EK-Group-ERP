'use client';

import { LayoutDashboard } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DashboardScreen } from '@/components/workplace/DashboardScreen';

/**
 * My Day — the Workplace dashboard, and the page a login lands on.
 *
 * A USER dashboard, not a company one: it covers every company and branch the
 * signed-in user has privileges for. See DashboardScreen for why that scope is
 * the whole point of it.
 */
export default function WorkplaceDashboardPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="My Day"
        description="Everything waiting for you, across the group"
        icon={<LayoutDashboard className="h-5 w-5" />}
      />
      <DashboardScreen />
    </div>
  );
}
