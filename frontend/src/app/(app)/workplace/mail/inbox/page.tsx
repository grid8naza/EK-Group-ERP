'use client';

import { Inbox } from 'lucide-react';
import { ComingSoon } from '@/components/workplace/ComingSoon';

export default function Page() {
  return (
    <ComingSoon
      title="Inbox"
      description="Internal mail addressed to you"
      icon={<Inbox className="h-5 w-5" />}
      building="Your internal mail, with read status, attachments and search."
      requirement="FR-COM-01"
    />
  );
}
