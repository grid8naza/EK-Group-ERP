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
        'inline-flex flex-wrap items-center gap-1 rounded-full border border-slate-200 bg-slate-100/70 p-1 dark:border-slate-800 dark:bg-slate-900',
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
            'flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
            active === t.key
              ? 'bg-white text-brand-700 dark:bg-slate-700 dark:text-white'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}
