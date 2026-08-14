'use client';

import { Hammer } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';

/**
 * A screen that exists in the menu but is not built yet.
 *
 * The menu entry, its Object Master row and its privilege column are seeded
 * ahead of the screen on purpose — an admin can grant access to it, and a
 * workflow can be bound to it, before anybody writes the page. This stands in
 * so that following the menu explains itself rather than landing on a 404.
 *
 * Lives in components/ui rather than under one module: it was written for the
 * Workplace screens, and the HR module now stages Employee Master the same way.
 * Delete a usage when its real screen lands.
 */
export function ComingSoon({
  title,
  description,
  icon,
  building,
  requirement,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  /** What this screen will do, in the words the SRS uses. */
  building: string;
  /** The SRS requirement it satisfies, e.g. "FR-COM-01". */
  requirement?: string;
}) {
  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader title={title} description={description} icon={icon} />
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-md rounded-xl border border-dashed border-slate-300 px-8 py-10 text-center dark:border-slate-700">
          <Hammer className="mx-auto mb-3 h-8 w-8 text-slate-300 dark:text-slate-600" />
          <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Not built yet
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {building}
          </p>
          {requirement && (
            <p className="mt-3 text-xs text-slate-400">
              Software Requirements Specification · {requirement}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
