'use client';

import { cn } from '@/lib/utils';

/**
 * The heading that divides a long form into blocks — "Personal Details",
 * "Financial & statutory".
 *
 * A centred band in a light blue rather than a line with a label on it: the
 * tint is what separates one block from the next, and it carries as a heading
 * instead of reading as another field label. It spans the whole grid, so a
 * two-column form breaks cleanly at it.
 *
 * Deliberately NOT brand-*: that palette is evergreen, and a heading in it
 * would look like a button that failed to render.
 *
 * One component rather than the className copied into each form, so the next
 * form to grow a second block gets the same heading without anybody choosing a
 * shade. Drop it straight into the grid:
 *
 *   <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
 *     <FormSection>Personal Details</FormSection>
 *     <Input … />
 */
export function FormSection({
  children,
  className,
}: {
  children: React.ReactNode;
  /** Extra classes — e.g. a wider span on a three-column grid. */
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mt-2 rounded-lg bg-blue-50 px-3 py-2 text-center text-base font-bold text-blue-900 dark:bg-blue-950/40 dark:text-blue-300 sm:col-span-2',
        className,
      )}
    >
      {children}
    </div>
  );
}
