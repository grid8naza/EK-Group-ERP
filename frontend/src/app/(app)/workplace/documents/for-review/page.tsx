'use client';

import { Eye } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { TaskInbox } from '@/components/workplace/TaskInbox';

/**
 * For Review — documents put in front of this person to READ, not to decide on.
 *
 * Three ways one gets here, all of them the workflow engine's doing:
 *  - a step sent it for reference (CREATE_REFERENCE / REFERENCE): information,
 *    nothing expected beyond reading it;
 *  - a step is review-and-forward (REVIEW_FORWARD): look at it, pass it on;
 *  - the step WOULD have asked them to approve, but the document's value is
 *    beyond the limit set for them, so the most they can do is review it and
 *    send it up.
 *
 * Separated from For Approval because mixing them misrepresents both: a
 * reference copy sitting in a list headed "waiting on you" reads as a job
 * undone, and a real decision buried among ten of them is easy to miss. Acting
 * still happens on the document itself — this screen takes them there, for the
 * same reason the approval inbox does: what a step means is the owning module's
 * business, and signing off something you cannot see is signing a reference
 * number.
 */
export default function ForReviewPage() {
  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="For Review"
        description="Documents sent to you to read, not to decide on — reference copies, and anything beyond your limit"
        icon={<Eye className="h-5 w-5" />}
      />
      <TaskInbox
        kind="REVIEW"
        countLabel={(n) => `${n} to read`}
        emptyText="Nothing has been sent to you to review."
        searchPlaceholder="Search document, kind, workflow, company or branch…"
      />
    </div>
  );
}
