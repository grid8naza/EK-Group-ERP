'use client';

import { Send } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { MailboxScreen } from '@/components/workplace/MailboxScreen';

/**
 * Sent — mail you have written, and how far it has been read (SRS §8.11,
 * FR-COM-01). Same screen as the Inbox, read from the other end.
 */
export default function SentPage() {
  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Sent"
        description="Mail you have sent, and who has read it"
        icon={<Send className="h-5 w-5" />}
      />
      <div className="min-h-0 flex-1 pb-4">
        <MailboxScreen box="sent" />
      </div>
    </div>
  );
}
