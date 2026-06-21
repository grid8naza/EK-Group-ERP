'use client';

import { cn } from '@/lib/utils';

type BadgeColor = 'green' | 'red' | 'blue' | 'amber' | 'slate' | 'violet';

const COLORS: Record<BadgeColor, string> = {
  green:
    'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  red: 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  blue: 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  violet:
    'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
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
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        COLORS[color],
        className,
      )}
    >
      {children}
    </span>
  );
}
