'use client';

import { Megaphone } from 'lucide-react';
import { ComingSoon } from '@/components/workplace/ComingSoon';

export default function Page() {
  return (
    <ComingSoon
      title="View Broadcasts"
      description="Broadcasts sent across the group"
      icon={<Megaphone className="h-5 w-5" />}
      building="Past broadcasts and who they reached."
      requirement="FR-COM-03"
    />
  );
}
