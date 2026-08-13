'use client';

import { BookOpen } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { CircularScreen } from '@/components/workplace/CircularScreen';

/**
 * View Circulars — what has been issued to you, what you have issued, and the
 * archive behind both (SRS §8.11, FR-COM-04).
 *
 * Like the mailbox, the screen owns the full height below the header: a list
 * beside a reading pane, each scrolling inside its own frame rather than the
 * page scrolling around them.
 */
export default function ViewCircularsPage() {
  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="View Circulars"
        description="Circulars issued to you, and the archive"
        icon={<BookOpen className="h-5 w-5" />}
      />
      <div className="min-h-0 flex-1 pb-4">
        <CircularScreen />
      </div>
    </div>
  );
}
