'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PencilLine } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { MailComposer } from '@/components/workplace/MailComposer';

/**
 * New Mail — write one message to anyone in the group (SRS §8.11, FR-COM-01).
 *
 * Sending leaves for Sent rather than clearing the form in place: the mail has
 * gone, and the useful next thing is seeing it sitting there with nobody having
 * read it yet. Writing another is one click from that screen.
 *
 * `?draft=N` carries on with a saved one, which is how the Drafts screen opens
 * it.
 */
function NewMail() {
  const router = useRouter();
  const params = useSearchParams();
  const draftId = Number(params.get('draft')) || undefined;

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col">
      <PageHeader
        title={draftId ? 'Draft' : 'New Mail'}
        description={
          draftId
            ? 'Carry on where you left off, or send it'
            : 'Write a message to someone in the group'
        }
        icon={<PencilLine className="h-5 w-5" />}
      />
      <div className="min-h-0 flex-1 pb-4">
        <div className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <MailComposer
            // Remount on a different draft, so the composer starts from that
            // draft's content rather than the last one's.
            key={draftId ?? 'new'}
            draftId={draftId}
            onSent={() => router.push('/workplace/mail/sent')}
            onCancel={() =>
              router.push(
                draftId ? '/workplace/mail/drafts' : '/workplace/mail/inbox',
              )
            }
            onDraftGone={() => router.push('/workplace/mail/drafts')}
          />
        </div>
      </div>
    </div>
  );
}

export default function NewMailPage() {
  // useSearchParams needs a boundary to render inside — without it the whole
  // route opts out of static rendering at build.
  return (
    <Suspense>
      <NewMail />
    </Suspense>
  );
}
