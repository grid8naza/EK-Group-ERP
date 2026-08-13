'use client';

import { Megaphone } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { BroadcastScreen } from '@/components/workplace/BroadcastScreen';

/**
 * View Broadcasts — the announcements aimed at you, and the ones you sent
 * (SRS §8.11, FR-COM-03).
 *
 * The screen owns the full height below the header: a feed scrolls inside its
 * own frame rather than the page scrolling around it.
 */
export default function ViewBroadcastsPage() {
  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="View Broadcasts"
        description="Broadcasts sent across the group"
        icon={<Megaphone className="h-5 w-5" />}
      />
      <div className="min-h-0 flex-1 pb-4">
        <BroadcastScreen />
      </div>
    </div>
  );
}
