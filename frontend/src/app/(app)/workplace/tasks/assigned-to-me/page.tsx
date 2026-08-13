'use client';

import { ClipboardCheck } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { TaskScreen } from '@/components/workplace/TaskScreen';

/**
 * Assigned to Me — the work this person owes (SRS §8.12, FR-TSK-01/03).
 *
 * A board rather than a list by default: what matters about your own work is
 * which of it has been started, which is stuck and which is finished, and a
 * flat list says none of that.
 */
export default function AssignedToMePage() {
  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Assigned to Me"
        description="Work other people are waiting on you for — drag a card to move it on"
        icon={<ClipboardCheck className="h-5 w-5" />}
      />
      <TaskScreen side="to-me" />
    </div>
  );
}
