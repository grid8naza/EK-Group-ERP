'use client';

import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CoaAccount } from '@/lib/types';

/** The boolean columns of an account that are worth filtering a list by. */
export type AttributeKey = keyof Pick<
  CoaAccount,
  | 'isContra'
  | 'isControl'
  | 'isGstRelevant'
  | 'isCash'
  | 'isBank'
  | 'isPdcIssued'
  | 'isPdcReceived'
  | 'isReconcilable'
  | 'allowManualJe'
  | 'isActive'
>;

/** Unset = the attribute is not being filtered on at all. */
export type AttributeState = 'yes' | 'no';
export type AttributeFilters = Partial<Record<AttributeKey, AttributeState>>;

/**
 * Named and worded exactly as the drawer words them, so a tick there and a
 * filter here are plainly the same thing.
 */
export const ATTRIBUTES: { key: AttributeKey; label: string; hint: string }[] = [
  { key: 'isContra', label: 'Contra', hint: 'Offsets its own group' },
  { key: 'isControl', label: 'Control', hint: 'Aged by a party' },
  { key: 'isGstRelevant', label: 'GST relevant', hint: 'Feeds the GST returns' },
  { key: 'isCash', label: 'Cash', hint: 'Money in hand — a till, a petty cash box' },
  { key: 'isBank', label: 'Bank', hint: 'Money at a bank' },
  {
    key: 'isPdcIssued',
    label: 'PDC issued',
    hint: 'Holds cheques we wrote, until they are presented',
  },
  {
    key: 'isPdcReceived',
    label: 'PDC received',
    hint: 'Holds cheques we were given, until they clear',
  },
  { key: 'isReconcilable', label: 'Reconcilable', hint: 'Agreed to an outside statement' },
  {
    key: 'allowManualJe',
    label: 'Allow manual journal',
    hint: 'May be named on a hand-written voucher',
  },
  { key: 'isActive', label: 'Active', hint: 'Still offered on new entries' },
];

/** Does this account satisfy every attribute that has been asked for? */
export const matchesAttributes = (a: CoaAccount, f: AttributeFilters) =>
  ATTRIBUTES.every(({ key }) => {
    const want = f[key];
    return !want || a[key] === (want === 'yes');
  });

/**
 * The seven yes/no attributes of an account, as a filter.
 *
 * Each is asked THREE ways rather than two — any, yes, no. A plain checklist can
 * only say "must be GST relevant", and half the reason to filter on these is the
 * other question: which accounts are NOT reconcilable, which refuse a manual
 * journal, what has been retired. Unset is the resting state, so the list is
 * unfiltered until something is actually asked for.
 */
export function AttributeFilter({
  value,
  onChange,
}: {
  value: AttributeFilters;
  onChange: (next: AttributeFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const set = (key: AttributeKey, state: AttributeState | null) => {
    const next = { ...value };
    if (state) next[key] = state;
    else delete next[key];
    onChange(next);
  };

  const active = ATTRIBUTES.filter(({ key }) => value[key]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Filter by what the account IS — contra, control, GST, bank, reconcilable, manual journal, active"
        className={cn(
          'btn-secondary flex-none gap-1.5',
          active.length > 0 && 'text-brand-600 dark:text-brand-400',
        )}
      >
        <SlidersHorizontal className="h-4 w-4" />
        Attributes
        {active.length > 0 && (
          <span className="rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">
            {active.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1 max-h-[min(70vh,28rem)] w-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
          <div className="sticky top-0 flex items-center justify-between bg-white px-3 py-1.5 dark:bg-slate-900">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Attributes
            </p>
            {active.length > 0 && (
              <button
                type="button"
                onClick={() => onChange({})}
                className="text-xs text-slate-400 hover:text-brand-600"
              >
                Clear
              </button>
            )}
          </div>
          {ATTRIBUTES.map((a) => (
            <div
              key={a.key}
              className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm text-slate-700 dark:text-slate-200">
                  {a.label}
                </span>
                <span className="block truncate text-[11px] text-slate-400">
                  {a.hint}
                </span>
              </span>
              <span className="flex flex-none overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                {(
                  [
                    [null, 'Any'],
                    ['yes', 'Yes'],
                    ['no', 'No'],
                  ] as const
                ).map(([state, label]) => {
                  const on = (value[a.key] ?? null) === state;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => set(a.key, state)}
                      className={cn(
                        'px-2 py-1 text-xs transition',
                        on
                          ? 'bg-brand-600 text-white'
                          : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * What is currently being asked for, on the toolbar itself — a filter behind a
 * dropdown is otherwise invisible, and a short list with no visible reason for
 * being short reads as missing data.
 */
export function AttributeChips({
  value,
  onChange,
}: {
  value: AttributeFilters;
  onChange: (next: AttributeFilters) => void;
}) {
  const active = ATTRIBUTES.filter(({ key }) => value[key]);
  if (!active.length) return null;
  return (
    <>
      {active.map((a) => (
        <button
          key={a.key}
          type="button"
          onClick={() => {
            const next = { ...value };
            delete next[a.key];
            onChange(next);
          }}
          title="Remove this filter"
          className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs text-brand-700 hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-300"
        >
          {value[a.key] === 'no' && 'Not '}
          {a.label}
          <X className="h-3 w-3" />
        </button>
      ))}
    </>
  );
}
