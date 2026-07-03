'use client';

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FieldWrapProps {
  label?: string;
  /** Tooltip shown on hover over the label (e.g. an abbreviation's full form). */
  labelTitle?: string;
  required?: boolean;
  error?: string;
  className?: string;
  children: React.ReactNode;
}

export function FieldWrap({
  label,
  labelTitle,
  required,
  error,
  className,
  children,
}: FieldWrapProps) {
  return (
    <div className={className}>
      {label && (
        <label
          className={cn('label', labelTitle && 'cursor-help')}
          title={labelTitle}
        >
          {label}
          {required && <span className="ml-0.5 text-rose-500">*</span>}
        </label>
      )}
      {children}
      {error && <p className="mt-1 text-xs text-rose-500">{error}</p>}
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  labelTitle?: string;
  required?: boolean;
  error?: string;
  wrapClassName?: string;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, labelTitle, required, error, wrapClassName, className, ...props },
  ref,
) {
  return (
    <FieldWrap
      label={label}
      labelTitle={labelTitle}
      required={required}
      error={error}
      className={wrapClassName}
    >
      <input ref={ref} className={cn('input-base', className)} {...props} />
    </FieldWrap>
  );
});

type SelectOption = { value: string | number; label: string };

/**
 * Minimal change-event shape the combobox synthesizes for `onChange`, so the
 * many existing callers that read `e.target.value` keep working unchanged after
 * the native `<select>` was replaced with a searchable combobox.
 */
type SyntheticSelectEvent = { target: { value: string } };

type SelectProps = {
  label?: string;
  required?: boolean;
  error?: string;
  wrapClassName?: string;
  className?: string;
  options?: SelectOption[];
  placeholder?: string;
  value?: string | number | null;
  onChange?: (e: SyntheticSelectEvent) => void;
  disabled?: boolean;
  name?: string;
  id?: string;
  title?: string;
  /** Sort options A→Z by label. On by default (project-wide convention). */
  sortOptions?: boolean;
  /** Show the type-to-search box once the list has more than this many items. */
  searchThreshold?: number;
};

/**
 * Searchable combobox used for every dropdown in the app. Keeps the old native
 * `<select>` API (`value` + `onChange(e => e.target.value)` + `options`/
 * `placeholder`) so it's a drop-in replacement, while adding type-to-search and
 * A→Z sorting. The search box only appears once a list is long enough to make
 * scrolling tedious (see `searchThreshold`).
 */
export function Select({
  label,
  required,
  error,
  wrapClassName,
  className,
  options,
  placeholder,
  value,
  onChange,
  disabled,
  name,
  id,
  title,
  sortOptions = true,
  searchThreshold = 8,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Sorted copy of the caller's options (A→Z by label) — leaves the source
  // array untouched.
  const sorted = useMemo(() => {
    const list = options ?? [];
    if (!sortOptions) return list;
    return [...list].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
    );
  }, [options, sortOptions]);

  const selected =
    value !== undefined && value !== null && value !== ''
      ? sorted.find((o) => String(o.value) === String(value))
      : undefined;

  const showSearch = sorted.length > searchThreshold;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? sorted.filter((o) => o.label.toLowerCase().includes(q))
    : sorted;

  // Close on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Reset transient state whenever the dropdown opens/closes; focus the search.
  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    setHighlight(0);
    if (showSearch) searchRef.current?.focus();
  }, [open, showSearch]);

  const choose = (val: string | number) => {
    onChange?.({ target: { value: String(val) } });
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[highlight];
      if (opt) choose(opt.value);
    }
  };

  // Keep the highlighted row in view as the user arrows through.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const node = listRef.current.children[highlight] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  return (
    <FieldWrap
      label={label}
      required={required}
      error={error}
      className={wrapClassName}
    >
      <div className="relative" ref={ref}>
        <button
          type="button"
          id={id}
          name={name}
          title={title}
          disabled={disabled}
          onClick={() => !disabled && setOpen((v) => !v)}
          onKeyDown={onKeyDown}
          className={cn('input-base flex w-full items-center gap-2 text-left', className)}
        >
          <span className={cn('flex-1 truncate', !selected && 'text-slate-400')}>
            {selected ? selected.label : placeholder ?? ''}
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 flex-none text-slate-400 transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>

        {open && (
          <div className="absolute z-30 mt-1 w-full min-w-[15rem] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {showSearch && (
              <div className="relative border-b border-slate-100 p-2 dark:border-slate-800">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setHighlight(0);
                  }}
                  onKeyDown={onKeyDown}
                  placeholder="Search..."
                  className="input-base w-full pl-9"
                />
              </div>
            )}
            <div ref={listRef} className="max-h-60 overflow-y-auto p-1">
              {placeholder !== undefined && !q && (
                <button
                  type="button"
                  onClick={() => choose('')}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800',
                  )}
                >
                  <span className="flex-1 truncate text-left">{placeholder}</span>
                  {!selected && <Check className="h-4 w-4 flex-none" />}
                </button>
              )}
              {filtered.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-slate-400">
                  No matches
                </p>
              ) : (
                filtered.map((o, i) => {
                  const active = String(o.value) === String(value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => choose(o.value)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition',
                        i === highlight && 'bg-slate-100 dark:bg-slate-800',
                        active
                          ? 'font-medium text-brand-700 dark:text-brand-300'
                          : 'text-slate-700 dark:text-slate-200',
                      )}
                    >
                      <span className="flex-1 truncate text-left">{o.label}</span>
                      {active && <Check className="h-4 w-4 flex-none text-brand-600" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </FieldWrap>
  );
}

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  required?: boolean;
  error?: string;
  wrapClassName?: string;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { label, required, error, wrapClassName, className, ...props },
    ref,
  ) {
    return (
      <FieldWrap
        label={label}
        required={required}
        error={error}
        className={wrapClassName}
      >
        <textarea
          ref={ref}
          className={cn('input-base min-h-[84px] resize-y', className)}
          {...props}
        />
      </FieldWrap>
    );
  },
);

type CheckboxProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type'
> & {
  label?: string;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ label, className, ...props }, ref) {
    return (
      <label className="inline-flex cursor-pointer select-none items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input
          ref={ref}
          type="checkbox"
          className={cn(
            'h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800',
            className,
          )}
          {...props}
        />
        {label && <span>{label}</span>}
      </label>
    );
  },
);
