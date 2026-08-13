'use client';

import { Forward } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { TaskScreen } from '@/components/workplace/TaskScreen';

/**
 * Assigned by Me — the work this person has given out (SRS §8.12, FR-TSK-03).
 *
 * The same board as Assigned to Me, read from the other end: these cards show
 * who is on each task rather than who it came from, because the question this
 * screen answers is "who is behind, and on what?".
 */
export default function AssignedByMePage() {
  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Assigned by Me"
        description="Work you have given to other people — where each of it has got to"
        icon={<Forward className="h-5 w-5" />}
      />
      <TaskScreen side="by-me" />
    </div>
  );
}
