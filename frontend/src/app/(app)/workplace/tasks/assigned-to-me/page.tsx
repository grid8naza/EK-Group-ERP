'use client';

import { ClipboardCheck } from 'lucide-react';
import { ComingSoon } from '@/components/workplace/ComingSoon';

export default function Page() {
  return (
    <ComingSoon
      title="Assigned to Me"
      description="Work other people are waiting on you for"
      icon={<ClipboardCheck className="h-5 w-5" />}
      building="Your own task list and checklists, with due dates and status."
      requirement="FR-TSK-01"
    />
  );
}
