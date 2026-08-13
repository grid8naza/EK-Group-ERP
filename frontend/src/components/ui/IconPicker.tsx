'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { FIELD_CHANGE_EVENT, FieldWrap } from './Field';
import { ICON_OPTIONS, resolveIcon } from '@/lib/icons';
import { cn } from '@/lib/utils';

interface IconPickerProps {
  label?: string;
  required?: boolean;
  error?: string;
  wrapClassName?: string;
  value?: string | null;
  onChange: (name: string) => void;
  placeholder?: string;
}

/**
 * Dropdown that lets the user pick an icon. The trigger and every option show
 * the icon glyph alongside its name, so the chosen icon is always visible.
 */
export function IconPicker({
  label,
  required,
  error,
  wrapClassName,
  value,
  onChange,
  placeholder = 'Select an icon',
}: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
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

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const selected = value
    ? ICON_OPTIONS.find((o) => o.name === value)
    : undefined;
  const SelectedIcon = value ? resolveIcon(value) : null;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? ICON_OPTIONS.filter(
        (o) =>
          o.label.toLowerCase().includes(q) || o.name.toLowerCase().includes(q),
      )
    : ICON_OPTIONS;

  // Like the combobox, this one changes value through a callback rather than
  // through the DOM, so it says so itself — see FIELD_CHANGE_EVENT.
  const announce = () =>
    ref.current?.dispatchEvent(
      new CustomEvent(FIELD_CHANGE_EVENT, { bubbles: true }),
    );

  const pick = (name: string) => {
    onChange(name);
    announce();
    setOpen(false);
  };

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
          onClick={() => setOpen((v) => !v)}
          className="input-base flex w-full items-center gap-2 text-left"
        >
          {SelectedIcon ? (
            <SelectedIcon className="h-[18px] w-[18px] flex-none text-slate-600 dark:text-slate-300" />
          ) : null}
          <span className={cn('flex-1 truncate', !value && 'text-slate-400')}>
            {selected ? selected.label : value || placeholder}
          </span>
          {value && (
            <X
              role="button"
              aria-label="Clear icon"
              className="h-4 w-4 flex-none text-slate-400 hover:text-rose-500"
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
                announce();
              }}
            />
          )}
          <ChevronDown
            className={cn(
              'h-4 w-4 flex-none text-slate-400 transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>

        {open && (
          <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
            <div className="relative border-b border-slate-100 p-2 dark:border-slate-800">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search icons..."
                className="input-base w-full pl-9"
              />
            </div>
            <div className="max-h-60 overflow-y-auto p-1">
              {filtered.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-slate-400">
                  No icons found
                </p>
              ) : (
                filtered.map((o) => {
                  const active = o.name === value;
                  return (
                    <button
                      key={o.name}
                      type="button"
                      onClick={() => pick(o.name)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition',
                        active
                          ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                          : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
                      )}
                    >
                      <o.Icon className="h-[18px] w-[18px] flex-none" />
                      <span className="flex-1 truncate text-left">
                        {o.label}
                      </span>
                      <span className="text-xs text-slate-400">{o.name}</span>
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
