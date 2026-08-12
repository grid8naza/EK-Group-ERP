'use client';

import { Send } from 'lucide-react';
import { ComingSoon } from '@/components/workplace/ComingSoon';

export default function Page() {
  return (
    <ComingSoon
      title="Sent"
      description="Internal mail you have sent"
      icon={<Send className="h-5 w-5" />}
      building="Everything you have sent, with who has read it."
      requirement="FR-COM-01"
    />
  );
}
