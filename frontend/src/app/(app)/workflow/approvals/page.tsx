'use client';

import { Inbox } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { TaskInbox } from '@/components/workplace/TaskInbox';

/**
 * For Approval — everything waiting on this person to DECIDE, wherever it is.
 *
 * Its other half is Documents → For Review, which lists what was sent to them
 * to read rather than to sign. Both are the same inbox, split by the engine's
 * own answer to "is this a decision?" (WorkflowTaskItem.kind), so nothing can
 * fall between the two lists or sit in both.
 *
 * Route deliberately unchanged (/workflow/approvals): the SubMenu and Object
 * Master rows are keyed by it, privileges hang off their ids, and the Topbar's
 * notification bell links straight to it.
 */
export default function MyApprovalsPage() {
  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="For Approval"
        description="Everything waiting on you to decide, in every company and branch — open one to read it and act"
        icon={<Inbox className="h-5 w-5" />}
      />
      <TaskInbox
        kind="APPROVAL"
        countLabel={(n) => `${n} waiting on you`}
        emptyText="Nothing is waiting on your decision."
        searchPlaceholder="Search document, kind, workflow, company or branch…"
      />
    </div>
  );
}
