'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Send } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { CircularComposer } from '@/components/workplace/CircularComposer';

/**
 * Send Circular — issue a formal notice to a chosen audience (SRS §8.11,
 * FR-COM-04).
 *
 * Issuing leaves for the archive rather than clearing the form: the notice has
 * gone out, and the useful next thing is the register sitting there with nobody
 * having acknowledged it yet.
 *
 * `?draft=N` carries on with a saved one, which is how the Drafts tab opens it.
 */
function SendCircular() {
  const router = useRouter();
  const params = useSearchParams();
  const draftId = Number(params.get('draft')) || undefined;

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col">
      <PageHeader
        title={draftId ? 'Circular Draft' : 'Send Circular'}
        description={
          draftId
            ? 'Carry on where you left off, or issue it'
            : 'Issue a formal notice to a chosen audience'
        }
        icon={<Send className="h-5 w-5" />}
      />
      <div className="min-h-0 flex-1 pb-4">
        <div className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <CircularComposer
            // Remount on a different draft, so the composer starts from that
            // draft's content rather than the last one's.
            key={draftId ?? 'new'}
            draftId={draftId}
            onIssued={() => router.push('/workplace/circulars/view')}
            onCancel={() => router.push('/workplace/circulars/view')}
            onDraftGone={() => router.push('/workplace/circulars/view')}
          />
        </div>
      </div>
    </div>
  );
}

export default function SendCircularPage() {
  // useSearchParams needs a boundary to render inside — without it the whole
  // route opts out of static rendering at build.
  return (
    <Suspense>
      <SendCircular />
    </Suspense>
  );
}
