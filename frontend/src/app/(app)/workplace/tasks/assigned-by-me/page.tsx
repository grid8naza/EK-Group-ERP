'use client';

import { Forward } from 'lucide-react';
import { ComingSoon } from '@/components/workplace/ComingSoon';

export default function Page() {
  return (
    <ComingSoon
      title="Assigned by Me"
      description="Work you have given to other people"
      icon={<Forward className="h-5 w-5" />}
      building="Tasks you raised for others — due dates, status and who is behind."
      requirement="FR-TSK-03"
    />
  );
}
