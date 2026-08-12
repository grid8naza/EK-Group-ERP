'use client';

import { Eye } from 'lucide-react';
import { ComingSoon } from '@/components/workplace/ComingSoon';

export default function Page() {
  return (
    <ComingSoon
      title="For Review"
      description="Documents sent to you to read, not to decide on"
      icon={<Eye className="h-5 w-5" />}
      building="Documents routed to you for reference or review — the workflow engine already raises these; this screen will list them."
      requirement="FR-WF"
    />
  );
}
