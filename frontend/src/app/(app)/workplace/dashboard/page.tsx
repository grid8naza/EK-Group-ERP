'use client';

import { DashboardScreen } from '@/components/workplace/DashboardScreen';

/**
 * My Day — the Workplace dashboard, and the page a login lands on.
 *
 * A USER dashboard, not a company one: it covers every company and branch the
 * signed-in user has privileges for. See DashboardScreen for why that scope is
 * the whole point of it.
 *
 * The header lives in the screen rather than here, unlike every other page:
 * the greeting sits in its right-hand slot and is built from what the screen
 * has loaded.
 */
export default function WorkplaceDashboardPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <DashboardScreen />
    </div>
  );
}
