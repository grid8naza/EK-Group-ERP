'use client';

import { Repeat } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { ChecklistScreen } from '@/components/workplace/ChecklistScreen';

/**
 * Recurring Checklists (SRS §8.12, FR-TSK-02) — opening and closing checks,
 * hygiene rounds, production sign-offs.
 *
 * The schedules only. Each occurrence is an ordinary task on the boards beside
 * this screen, which is where it is actually ticked.
 */
export default function ChecklistsPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Recurring Checklists"
        description="Set one up once; it raises itself on the board every time it is due"
        icon={<Repeat className="h-5 w-5" />}
      />
      <ChecklistScreen />
    </div>
  );
}
