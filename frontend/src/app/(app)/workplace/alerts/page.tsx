'use client';

import { Bell } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { AlertsScreen } from '@/components/workplace/AlertsScreen';

/**
 * Alerts — everything the system has raised for this person (SRS §8.11,
 * FR-COM-05). The bell in the topbar is the same feed, shortened.
 *
 * The screen owns the full height below the header: the list scrolls inside its
 * own frame rather than the page scrolling around it.
 */
export default function AlertsPage() {
  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col">
      <PageHeader
        title="Alerts"
        description="Raised for you by what is happening"
        icon={<Bell className="h-5 w-5" />}
      />
      <div className="min-h-0 flex-1 pb-4">
        <AlertsScreen />
      </div>
    </div>
  );
}
