'use client';

import { cn } from '@/lib/utils';

type BadgeColor = 'green' | 'red' | 'blue' | 'amber' | 'slate' | 'violet';

// Outlined status pills — a colored hairline ring + colored text on a
// transparent fill (matching the reference dashboard's Excellent / Good /
// Warning / Cancel chips). No fill, no shadow.
const COLORS: Record<BadgeColor, string> = {
  green:
    'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300',
  red: 'border-rose-300 text-rose-600 dark:border-rose-800 dark:text-rose-300',
  blue: 'border-blue-300 text-blue-600 dark:border-blue-800 dark:text-blue-300',
  amber:
    'border-amber-300 text-amber-600 dark:border-amber-800 dark:text-amber-300',
  slate:
    'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300',
  violet:
    'border-violet-300 text-violet-600 dark:border-violet-800 dark:text-violet-300',
};

export function Badge({
  children,
  color = 'slate',
  className,
}: {
  children: React.ReactNode;
  color?: BadgeColor;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        COLORS[color],
        className,
      )}
    >
      {children}
    </span>
  );
}
