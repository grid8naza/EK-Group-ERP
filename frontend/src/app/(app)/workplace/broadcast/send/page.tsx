'use client';

import { Send } from 'lucide-react';
import { ComingSoon } from '@/components/workplace/ComingSoon';

export default function Page() {
  return (
    <ComingSoon
      title="Send Broadcast"
      description="Message a company, branch, department or role"
      icon={<Send className="h-5 w-5" />}
      building="Broadcasting to a targeted audience — a selected company, branch, department or role rather than everyone."
      requirement="FR-COM-03"
    />
  );
}
