'use client';

import { PencilLine } from 'lucide-react';
import { ComingSoon } from '@/components/workplace/ComingSoon';

export default function Page() {
  return (
    <ComingSoon
      title="New Mail"
      description="Write a message to someone in the group"
      icon={<PencilLine className="h-5 w-5" />}
      building="Composing internal mail: subject, body, attachments and a recipient picker across companies and branches."
      requirement="FR-COM-01"
    />
  );
}
