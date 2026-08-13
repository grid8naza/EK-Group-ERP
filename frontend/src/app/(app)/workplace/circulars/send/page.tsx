'use client';

import { useRouter } from 'next/navigation';
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
 */
export default function SendCircularPage() {
  const router = useRouter();
  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col">
      <PageHeader
        title="Send Circular"
        description="Issue a formal notice to a chosen audience"
        icon={<Send className="h-5 w-5" />}
      />
      <div className="min-h-0 flex-1 pb-4">
        <div className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <CircularComposer
            onIssued={() => router.push('/workplace/circulars/view')}
          />
        </div>
      </div>
    </div>
  );
}
