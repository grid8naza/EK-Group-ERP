'use client';

import { Send } from 'lucide-react';
import { ComingSoon } from '@/components/workplace/ComingSoon';

export default function Page() {
  return (
    <ComingSoon
      title="Send Circular"
      description="Issue a formal notice to a chosen audience"
      icon={<Send className="h-5 w-5" />}
      building="Issuing a circular to a target audience, with acknowledgement tracking."
      requirement="FR-COM-04"
    />
  );
}
