'use client';

import { Inbox } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { MailboxScreen } from '@/components/workplace/MailboxScreen';

/**
 * Inbox — internal mail addressed to you (SRS §8.11, FR-COM-01).
 *
 * Like chat, the screen owns the full height below the header: a mailbox is a
 * list beside a reading pane, and both scroll inside their own frame rather
 * than the page scrolling around them.
 */
export default function InboxPage() {
  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Inbox"
        description="Mail addressed to you, from anywhere in the group"
        icon={<Inbox className="h-5 w-5" />}
      />
      <div className="min-h-0 flex-1 pb-4">
        <MailboxScreen box="inbox" />
      </div>
    </div>
  );
}
