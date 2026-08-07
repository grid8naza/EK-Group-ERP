'use client';

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, HelpCircle, Search, X } from 'lucide-react';
import { cn, isoDate } from '@/lib/utils';

/**
 * What a control fires when the user has changed it and no native event would
 * say so.
 *
 * An input, a textarea and a checkbox all announce themselves: the browser
 * raises `input` or `change` and it bubbles to whatever is listening. The
 * searchable combobox does not — it hands the new value straight to a callback
 * — so a form wrapper watching the DOM for edits would never hear it, and would
 * think a form the user had filled in was untouched.
 *
 * Bubbles, so any ancestor may listen. The Drawer does, to know whether closing
 * would actually lose anything.
 */
export const FIELD_CHANGE_EVENT = 'ek:field-change';

/**
 * Move focus to the field after `from`, in DOM order, within the nearest
 * data-entry container (`[data-enter-advance]` — every form body wrapped in
 * ReadOnlyFieldset). "Fields" are the visible, enabled inputs and textareas plus
 * the searchable-select triggers; action buttons are not part of the run.
 *
 * A no-op outside a data-entry form (listing filters, the login page) and on the
 * last field, so nothing traps focus or wraps around unexpectedly.
 */
export function focusNextField(from: HTMLElement) {
  const root = from.closest('[data-enter-advance]');
  if (!root) return;
  const fields = Array.from(
    root.querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]), textarea, button[data-field]',
    ),
  ).filter(
    (el) =>
      !(el as HTMLInputElement | HTMLButtonElement).disabled &&
      el.offsetParent !== null,
  );
  const i = fields.indexOf(from);
  if (i >= 0) fields[i + 1]?.focus();
}

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
  const isNumber = props.type === 'number';
  return (
    <FieldWrap
      label={label}
      labelTitle={labelTitle}
      required={required}
      error={error}
      className={wrapClassName}
    >
      {/* Numbers are right-aligned everywhere, so digits (and decimal points)
          line up down a column instead of drifting with their length. */}
      <input
        ref={ref}
        className={cn('input-base', isNumber && 'text-right', className)}
        {...props}
        // Spread first, then this: a figure arrived at by the keyboard is
        // selected on arrival, so the next digit typed REPLACES it. Correcting
        // an amount is retyping it, not backspacing over it a character at a
        // time — the same rule the date field follows. Numbers only, because
        // prose is usually appended to; and in practice keyboard only, since a
        // click still ends up placing the caret where it was clicked.
        onFocus={
          isNumber
            ? (e) => {
                e.currentTarget.select();
                props.onFocus?.(e);
              }
            : props.onFocus
        }
      />
    </FieldWrap>
  );
});

// ---- MoneyInput: a figure that reads as money the moment it is left ----

/** 1234.5 → "1,234.50". Blank stays blank: an empty box is not zero. */
export function formatMoney(value: string | number | null | undefined): string {
  if (value === '' || value === null || value === undefined) return '';
  const n = Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * What the form stores: digits and at most one dot, no separators.
 *
 * A second dot is dropped rather than kept, because "1.2.3" parses to nothing
 * and the field would silently be worth zero. Unsigned — which way an amount
 * pulls is said by its side, never by a minus in the box. Two decimals at most,
 * so what is stored is what the box shows rather than a third digit that only
 * reappears when something rounds.
 */
const stripMoney = (text: string) => {
  const [whole, ...rest] = text.replace(/[^\d.]/g, '').split('.');
  return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
};

interface MoneyInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'type'
  > {
  label?: string;
  required?: boolean;
  error?: string;
  wrapClassName?: string;
  /** The stored figure, unformatted — '', '3500', '3500.5'. */
  value: string;
  /** Called with the unformatted figure, so nothing downstream sees a comma. */
  onChange: (value: string) => void;
}

/**
 * A money field: grouped and to two decimals whenever it is not being typed in.
 *
 * A column of figures is read by comparing their shapes, and 500.5 next to 3500
 * defeats that — the eye has to parse each one. So the box shows 500.50 and
 * 3,500.00, and drops back to the plain number the moment the caret arrives:
 * separators are for reading, and having to type around them is worse than not
 * having them at all.
 *
 * The value that leaves here is always unformatted, so what is stored, sent and
 * totalled never carries a comma.
 */
export function MoneyInput({
  label,
  required,
  error,
  wrapClassName,
  className,
  value,
  onChange,
  onFocus,
  onBlur,
  ...props
}: MoneyInputProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  return (
    <FieldWrap
      label={label}
      required={required}
      error={error}
      className={wrapClassName}
    >
      <input
        type="text"
        inputMode="decimal"
        className={cn('input-base text-right', className)}
        {...props}
        value={editing ? draft : formatMoney(value)}
        onFocus={(e) => {
          setDraft(value);
          setEditing(true);
          // Arrived at by the keyboard, so the next digit typed REPLACES the
          // figure — correcting an amount is retyping it. Same rule as Input.
          e.currentTarget.select();
          onFocus?.(e);
        }}
        onChange={(e) => {
          const next = stripMoney(e.target.value);
          setDraft(next);
          onChange(next);
        }}
        onBlur={(e) => {
          setEditing(false);
          onBlur?.(e);
        }}
      />
    </FieldWrap>
  );
}

// ---- DateInput: a typed DD-MM-YYYY field that auto-formats as you type ----
// Sidesteps the native <input type="date"> quirk where single-digit months
// don't auto-advance to the year. `value`/`onChange` speak ISO (YYYY-MM-DD).

function isoToDisplay(iso?: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

/** Eight digits (or fewer, mid-typing) punctuated as DD-MM-YYYY. */
function format(digits: string): string {
  let out = digits.slice(0, 2);
  if (digits.length >= 3) out += '-' + digits.slice(2, 4);
  if (digits.length >= 5) out += '-' + digits.slice(4, 8);
  return out;
}

/** A DD-MM-YYYY display string → ISO YYYY-MM-DD, or '' when incomplete/invalid. */
function displayToIso(display: string): string {
  const digits = display.replace(/\D/g, '');
  if (digits.length !== 8) return '';
  const dd = +digits.slice(0, 2);
  const mm = +digits.slice(2, 4);
  const yyyy = +digits.slice(4, 8);
  const d = new Date(yyyy, mm - 1, dd);
  const valid =
    d.getFullYear() === yyyy && d.getMonth() === mm - 1 && d.getDate() === dd;
  return valid
    ? `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`
    : '';
}

interface DateInputProps {
  value?: string | null; // ISO YYYY-MM-DD (or empty)
  onChange: (iso: string) => void; // '' when incomplete/invalid
  id?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  /** When provided, the input is wrapped in the standard labelled field. */
  label?: string;
  required?: boolean;
  wrapClassName?: string;
}

export function DateInput({
  value,
  onChange,
  id,
  disabled,
  className,
  placeholder = 'DD-MM-YYYY',
  onKeyDown,
  label,
  required,
  wrapClassName,
}: DateInputProps) {
  const [text, setText] = useState(() => isoToDisplay(value));
  // Adopt an external value change (e.g. loading a document), but never clobber
  // an in-progress partial entry that already represents the same value.
  useEffect(() => {
    setText((cur) =>
      displayToIso(cur) === (value || '') ? cur : isoToDisplay(value),
    );
  }, [value]);

  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 8);
    setText(format(digits));
    onChange(displayToIso(format(digits)));
  };

  /**
   * Step the part of the date the caret is sitting in.
   *
   * Changing a date should not mean clearing one. Between this and the
   * select-on-focus below, a date is either retyped outright or nudged — never
   * backspaced away a character at a time, which is what it used to take.
   */
  const step = (e: React.KeyboardEvent<HTMLInputElement>, by: number) => {
    e.preventDefault();
    // Held onto: React clears `currentTarget` once the handler returns, and the
    // caret is restored a frame later.
    const el = e.currentTarget;
    const caret = el.selectionStart ?? 0;
    // 0-2 day, 3-5 month, else year — the segment the caret is inside.
    const part = caret <= 2 ? 0 : caret <= 5 ? 1 : 2;
    // Stepping an empty field starts from today HERE, not today in UTC.
    const base = displayToIso(text) || isoDate();
    const [y, m, d] = base.split('-').map(Number);
    // Built through Date so a rolled-over day or month lands on a real date —
    // 31 Jan stepped a month forward is 3 March, not 31 February.
    const next = new Date(
      part === 2 ? y + by : y,
      (part === 1 ? m + by : m) - 1,
      part === 0 ? d + by : d,
    );
    const iso = isoDate(next);
    setText(isoToDisplay(iso));
    onChange(iso);
    // Keep the caret in the segment being stepped, so a run of presses keeps
    // moving the same part.
    const at = part === 0 ? 1 : part === 1 ? 4 : 7;
    requestAnimationFrame(() => el.setSelectionRange(at, at));
  };

  const input = (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      disabled={disabled}
      value={text}
      onChange={handle}
      // Selected on arrival, so the first digit typed replaces the date that is
      // there rather than being appended to it.
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') return step(e, 1);
        if (e.key === 'ArrowDown') return step(e, -1);
        onKeyDown?.(e);
      }}
      placeholder={placeholder}
      className={cn('input-base', className)}
    />
  );
  if (label === undefined) return input; // bare (e.g. inside a table cell)
  return (
    <FieldWrap label={label} required={required} className={wrapClassName}>
      {input}
    </FieldWrap>
  );
}

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
  /** Show the type-to-search box once the list has more than this many items.
   *  Defaults to 0 — every picker searches, so the behaviour never depends on
   *  how many rows a master happens to hold today. */
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
  /** Render the selected option in normal font (still ticked) instead of the
   *  default bold + brand colour — used where the current value shouldn't stand
   *  out, e.g. the unit pickers. */
  plainSelected?: boolean;
};

/**
 * Searchable combobox used for every dropdown in the app. Keeps the old native
 * `<select>` API (`value` + `onChange(e => e.target.value)` + `options`/
 * `placeholder`) so it's a drop-in replacement, while adding type-to-search and
 * A→Z sorting. Every picker searches: a list that is short today grows, and a
 * box that comes and goes with the row count can't be relied on. Raise
 * `searchThreshold` on the rare picker that shouldn't have one.
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
  searchThreshold = 0,
  autoFocus = false,
  openOnFocus = false,
  advanceToId,
  plainSelected = false,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  // The dropdown renders in a portal (fixed-positioned) so it escapes any
  // overflow/scroll container it sits inside (e.g. a voucher line grid).
  const [menuPos, setMenuPos] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
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

  // Close on outside click (the dropdown is portaled, so also check menuRef).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        ref.current &&
        !ref.current.contains(t) &&
        (!menuRef.current || !menuRef.current.contains(t))
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Position the portaled dropdown under (or above) the trigger, following it on
  // scroll/resize while open. Flips upward when there isn't room below.
  useEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = r.width;
      const left = Math.max(
        8,
        Math.min(r.left, window.innerWidth - Math.max(width, 240) - 8),
      );
      const menuH = 320;
      const spaceBelow = window.innerHeight - r.bottom;
      if (spaceBelow < menuH && r.top > menuH) {
        setMenuPos({ left, width, bottom: window.innerHeight - r.top + 4 });
      } else {
        setMenuPos({ left, width, top: r.bottom + 4 });
      }
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

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

  const choose = (val: string | number, viaKeyboard = false) => {
    onChange?.({ target: { value: String(val) } });
    // Say out loud that a field changed. The callback above reaches the form's
    // state; this reaches whatever wraps the form — see FIELD_CHANGE_EVENT.
    ref.current?.dispatchEvent(
      new CustomEvent(FIELD_CHANGE_EVENT, { bubbles: true }),
    );
    setOpen(false);
    if (!advanceToId && viaKeyboard) {
      // Same rule as the plain inputs: picking a value with Enter moves on to
      // the next field. Only for keyboard entry — a mouse pick leaves focus
      // alone. Wait a tick so the dropdown has closed first.
      const el = buttonRef.current;
      if (el) setTimeout(() => focusNextField(el), 0);
      return;
    }
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
      if (opt) choose(opt.value, true);
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
          // Marks the trigger as a field, so Enter-to-advance treats the picker
          // as one stop in the run rather than skipping over it.
          data-field=""
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

        {open && menuPos &&
          createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              left: menuPos.left,
              width: menuPos.width,
              top: menuPos.top,
              bottom: menuPos.bottom,
            }}
            className="z-[60] min-w-[15rem] overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
            {showSearch && (
              <div className="relative border-b border-slate-100 p-2 dark:border-slate-800">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  ref={searchRef}
                  autoFocus
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
                        // Bold the cursored (hovered/arrowed) row and the current
                        // selection (plain selections stay normal until cursored).
                        (i === highlight || (active && !plainSelected)) &&
                          'font-semibold',
                        // Colour: the current selection is green; the cursored row
                        // is brand; everything else neutral.
                        active
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : i === highlight
                            ? 'text-brand-700 dark:text-brand-300'
                            : 'text-slate-700 dark:text-slate-200',
                      )}
                    >
                      <span className="flex-1 truncate text-left">{o.label}</span>
                      {active && (
                        <Check className="h-4 w-4 flex-none text-emerald-600 dark:text-emerald-400" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
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

/**
 * A "what does this mean?" note attached to a field.
 *
 * Opens on hover for a mouse and on click for a touch screen — a tooltip that
 * only answers to hover is unreadable on a tablet, which is where a lot of this
 * is used. Click is also what lets someone keep it open long enough to read it.
 *
 * It sits inside the field's <label>, so the click must be stopped from
 * reaching the control and toggling it.
 */
export function HelpTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={open ? 'Hide explanation' : 'What does this mean?'}
        aria-expanded={open}
        tabIndex={-1}
        className="text-slate-400 transition-colors hover:text-brand-600 dark:hover:text-brand-400"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 top-full z-50 mt-1.5 w-60 max-w-[min(15rem,80vw)] -translate-x-1/2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-normal leading-relaxed text-slate-600 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        >
          {text}
        </span>
      )}
    </span>
  );
}

type CheckboxProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type'
> & {
  label?: string;
  /** Plain-language explanation, shown behind a ? beside the label. */
  help?: string;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ label, help, className, ...props }, ref) {
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
        {help && <HelpTip text={help} />}
      </label>
    );
  },
);
