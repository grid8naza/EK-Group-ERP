'use client';

import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  /**
   * How loud the title is. `sm` is for a header whose right-hand side carries
   * content of its own rather than buttons — the Workplace dashboard puts a
   * greeting there, and a 24px title beside it makes the two compete.
   */
  size?: 'default' | 'sm';
}

export function PageHeader({
  title,
  description,
  icon,
  actions,
  size = 'default',
}: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {/* The title gives way, not the actions: `min-w-0` lets a long
          description wrap rather than push the buttons off the page. */}
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-400">
            {icon}
          </div>
        )}
        {/* The icon keeps its 40px; only the words give way. */}
        <div className="min-w-0">
          <h1
            className={cn(
              'font-bold text-slate-900 dark:text-white',
              size === 'sm' ? 'text-xl' : 'text-2xl',
            )}
          >
            {title}
          </h1>
          {description && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
