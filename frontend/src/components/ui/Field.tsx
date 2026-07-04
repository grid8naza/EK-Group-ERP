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
  /** Open the dropdown (and focus its search) on mount — for fast keyboard
   *  entry when the field is the first in a freshly opened form. */
  autoFocus?: boolean;
  /** Open (ready to search) whenever the field receives focus, e.g. via Tab —
   *  so keyboard users never need to click to start searching. */
  openOnFocus?: boolean;
  /** After a value is chosen, move focus to the element with this id (the next
   *  field, or the submit button on the last field) — for Enter-to-advance
   *  keyboard data entry. */
  advanceToId?: string;
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
  autoFocus = false,
  openOnFocus = false,
  advanceToId,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // True immediately after a value is picked, so the focus we return to the
  // trigger doesn't re-open the dropdown (openOnFocus).
  const justPickedRef = useRef(false);
  // True between mousedown and click on the trigger, so the focus-triggered open
  // (openOnFocus) stands down and lets the click toggle own the open state —
  // otherwise focus opens it and the same click immediately toggles it shut.
  const mouseDownRef = useRef(false);

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

  // Open on mount (which focuses the search) when asked — lets the user start
  // typing to search as soon as the field appears, no mouse click needed. The
  // small delay lets a slide-in drawer settle so focus reliably sticks.
  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => setOpen(true), 80);
    return () => clearTimeout(t);
  }, [autoFocus]);

  const choose = (val: string | number) => {
    onChange?.({ target: { value: String(val) } });
    setOpen(false);
    if (advanceToId) {
      // Enter-to-advance: move to the next field once a value is picked. Wait a
      // tick so the dropdown has closed before we move focus.
      const target = advanceToId;
      setTimeout(() => document.getElementById(target)?.focus(), 0);
    } else if (openOnFocus) {
      // Return focus to the trigger (so Tab continues), but suppress the
      // focus-triggered re-open.
      justPickedRef.current = true;
      buttonRef.current?.focus();
    }
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
          ref={buttonRef}
          type="button"
          id={id}
          name={name}
          title={title}
          disabled={disabled}
          onMouseDown={() => {
            mouseDownRef.current = true;
          }}
          onClick={() => {
            mouseDownRef.current = false;
            if (!disabled) setOpen((v) => !v);
          }}
          onFocus={() => {
            if (!openOnFocus || disabled) return;
            if (justPickedRef.current) {
              justPickedRef.current = false;
              return;
            }
            // A mouse press is opening this; let the click toggle handle it so
            // focus+click don't cancel each other out.
            if (mouseDownRef.current) return;
            setOpen(true);
          }}
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
