'use client';

import { useEffect, useRef, useState } from 'react';
import { Columns3, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ColumnToggleOption {
  key: string;
  label: string;
}

/**
 * Dropdown that lets the user show/hide table columns. The parent owns the
 * `hidden` set (so it can persist it); this just renders the checklist.
 */
export function ColumnToggle({
  columns,
  hidden,
  onToggle,
}: {
  columns: ColumnToggleOption[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const hiddenCount = columns.filter((c) => hidden.has(c.key)).length;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Show/hide columns"
        className="btn-secondary px-2.5"
      >
        <Columns3 className="h-4 w-4" />
        {hiddenCount > 0 && (
          <span className="text-xs text-slate-400">{hiddenCount} hidden</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Columns
          </p>
          {columns.map((c) => {
            const visible = !hidden.has(c.key);
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => onToggle(c.key)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <span
                  className={cn(
                    'flex h-4 w-4 flex-none items-center justify-center rounded border',
                    visible
                      ? 'border-brand-500 bg-brand-500 text-white'
                      : 'border-slate-300 dark:border-slate-600',
                  )}
                >
                  {visible && <Check className="h-3 w-3" />}
                </span>
                <span className="flex-1 text-left">{c.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
