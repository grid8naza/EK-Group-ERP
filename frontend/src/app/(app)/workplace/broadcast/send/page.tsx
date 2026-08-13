'use client';

import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { BroadcastComposer } from '@/components/workplace/BroadcastComposer';

/**
 * Send Broadcast — announce something to a company, branch or role
 * (SRS §8.11, FR-COM-03).
 *
 * Sending leaves for the feed rather than clearing the form: the announcement is
 * out, and the useful next thing is seeing it sitting at the top of the list the
 * way the people it went to will see it.
 */
export default function SendBroadcastPage() {
  const router = useRouter();
  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col">
      <PageHeader
        title="Send Broadcast"
        description="Message a company, branch, department or role"
        icon={<Send className="h-5 w-5" />}
      />
      <div className="min-h-0 flex-1 pb-4">
        <div className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <BroadcastComposer
            onSent={() => router.push('/workplace/broadcast/view')}
          />
        </div>
      </div>
    </div>
  );
}
