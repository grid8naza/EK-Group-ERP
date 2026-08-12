'use client';

import { BookOpen } from 'lucide-react';
import { ComingSoon } from '@/components/workplace/ComingSoon';

export default function Page() {
  return (
    <ComingSoon
      title="View Circulars"
      description="Circulars issued to you, and the archive"
      icon={<BookOpen className="h-5 w-5" />}
      building="The circular archive, and whether each person has acknowledged theirs."
      requirement="FR-COM-04"
    />
  );
}
