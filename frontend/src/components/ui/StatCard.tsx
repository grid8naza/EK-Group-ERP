'use client';

import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  accent?: 'blue' | 'emerald' | 'amber' | 'violet' | 'rose' | 'slate';
  hint?: string;
}

const ACCENTS: Record<NonNullable<StatCardProps['accent']>, string> = {
  blue: 'bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-400',
  emerald:
    'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
  violet:
    'bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-400',
  rose: 'bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

export function StatCard({
  label,
  value,
  icon,
  accent = 'blue',
  hint,
}: StatCardProps) {
  return (
    <div className="card flex items-center justify-between p-5">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {label}
        </p>
        <p className="mt-1 text-3xl font-bold text-slate-900 dark:text-white">
          {value}
        </p>
        {hint && (
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            {hint}
          </p>
        )}
      </div>
      {icon && (
        <div
          className={cn(
            'flex h-12 w-12 items-center justify-center rounded-xl',
            ACCENTS[accent],
          )}
        >
          {icon}
        </div>
      )}
    </div>
  );
}
