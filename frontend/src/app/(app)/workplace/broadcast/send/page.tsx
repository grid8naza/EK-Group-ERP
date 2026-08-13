'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
 *
 * `?draft=N` carries on with a saved one, which is how the Drafts tab opens it.
 */
function SendBroadcast() {
  const router = useRouter();
  const params = useSearchParams();
  const draftId = Number(params.get('draft')) || undefined;

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col">
      <PageHeader
        title={draftId ? 'Broadcast Draft' : 'Send Broadcast'}
        description={
          draftId
            ? 'Carry on where you left off, or send it'
            : 'Message a company, branch, department or role'
        }
        icon={<Send className="h-5 w-5" />}
      />
      <div className="min-h-0 flex-1 pb-4">
        <div className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <BroadcastComposer
            key={draftId ?? 'new'}
            draftId={draftId}
            onSent={() => router.push('/workplace/broadcast/view')}
            onCancel={() => router.push('/workplace/broadcast/view')}
            onDraftGone={() => router.push('/workplace/broadcast/view')}
          />
        </div>
      </div>
    </div>
  );
}

export default function SendBroadcastPage() {
  // See the circular composer's page for why the boundary is here.
  return (
    <Suspense>
      <SendBroadcast />
    </Suspense>
  );
}
