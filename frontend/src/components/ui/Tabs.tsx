'use client';

import { cn } from '@/lib/utils';

export interface TabDef {
  key: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

interface TabsProps {
  tabs: TabDef[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}

export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  return (
    <div
      className={cn(
        'flex gap-1 border-b border-slate-200 dark:border-slate-800',
        className,
      )}
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          disabled={t.disabled}
          onClick={() => onChange(t.key)}
          className={cn(
            '-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
            active === t.key
              ? 'border-brand-600 text-brand-600'
              : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}
