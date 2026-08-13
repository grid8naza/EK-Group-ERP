'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { API_URL, api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ChatDirectoryUser } from '@/lib/types';

/**
 * The pieces every Workplace screen draws people and files with.
 *
 * Shared rather than copied because chat and mail show the SAME person: an
 * avatar whose colour drifted between two screens, or a date that read
 * "Yesterday" in one and "11 Aug" in the other, would look like two systems
 * rather than one module. Everything here is presentation only.
 */

/** A file's URL is relative to the API host, not to the Next.js origin. */
export const fileUrl = (url: string) =>
  `${API_URL.replace(/\/api$/, '')}${url}`;

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';

/**
 * A stable colour per person, so the same face is the same colour every time
 * without storing one. Hue off the id, fixed saturation/lightness so every
 * avatar carries white text legibly in both themes.
 */
export const avatarStyle = (id: number) => ({
  backgroundColor: `hsl(${(id * 47) % 360} 55% 45%)`,
});

export const clockOf = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

/** Day heading above the first item of each day. */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

/** Compact time for a list — clock today, date before that. */
export function listTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return clockOf(iso);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

/** The full stamp, for a message you have opened rather than skimmed. */
export function fullTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const humanSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export function Avatar({
  name,
  id,
  online,
  size = 'md',
}: {
  name: string;
  id: number;
  online?: boolean;
  size?: 'sm' | 'md';
}) {
  const dim = size === 'sm' ? 'h-8 w-8 text-[11px]' : 'h-10 w-10 text-xs';
  return (
    <div className="relative shrink-0">
      <div
        className={cn(
          'flex items-center justify-center rounded-full font-semibold text-white',
          dim,
        )}
        style={avatarStyle(id)}
      >
        {initialsOf(name)}
      </div>
      {online && (
        <span
          className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500 dark:border-slate-900"
          title="Online"
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------- the picker --

/** Somebody chosen on a form — the little the caller needs to keep. */
export interface PickedPerson {
  id: number;
  name: string;
}

/**
 * A line of people: the ones already chosen as chips, and a search that offers
 * the rest of the directory.
 *
 * Shared by mail's To/Cc lines and by the task composer's assignees, from
 * whichever directory the caller names — each module answers "who can this
 * person reach" for itself, and the control has no opinion about it.
 *
 * The directory is fetched once and filtered here rather than per keystroke:
 * it is everybody you work with, which is a list of tens, and a round trip per
 * letter would be slower than the typing.
 */
export function PeopleField({
  label,
  endpoint,
  chosen,
  exclude = [],
  onChange,
  action,
  autoFocus,
  placeholder = 'Search people…',
}: {
  label: string;
  /** Where the people come from, e.g. "/mail/directory". */
  endpoint: string;
  chosen: PickedPerson[];
  /** Ids already spoken for elsewhere on the form — nobody is chosen twice. */
  exclude?: number[];
  onChange: (people: PickedPerson[]) => void;
  action?: React.ReactNode;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [directory, setDirectory] = useState<ChatDirectoryUser[]>([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<ChatDirectoryUser[]>(endpoint)
      .then((people) => alive && setDirectory(people))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [endpoint]);

  // Clicking anywhere else closes the suggestions — they sit over the form.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const taken = useMemo(
    () => new Set([...chosen.map((p) => p.id), ...exclude]),
    [chosen, exclude],
  );

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return directory
      .filter((p) => !taken.has(p.id))
      .filter(
        (p) =>
          !needle ||
          [p.name, p.username, p.userCode, p.email]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(needle)),
      )
      .slice(0, 40);
  }, [directory, q, taken]);

  const add = (p: ChatDirectoryUser) => {
    onChange([...chosen, { id: p.id, name: p.name }]);
    setQ('');
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="mb-1 flex items-center justify-between">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
          {label}
        </label>
        {action}
      </div>
      <div
        className="flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1.5 focus-within:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
        onClick={() => setOpen(true)}
      >
        {chosen.map((p) => (
          <span
            key={p.id}
            className="flex items-center gap-1.5 rounded-full bg-brand-50 py-0.5 pl-0.5 pr-2 text-xs font-medium text-brand-800 dark:bg-brand-950/60 dark:text-brand-200"
          >
            <Avatar name={p.name} id={p.id} size="sm" />
            {p.name}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(chosen.filter((x) => x.id !== p.id));
              }}
              className="text-brand-400 hover:text-rose-500"
              title={`Remove ${p.name}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches[0]) {
              e.preventDefault();
              add(matches[0]);
            }
            // Backspace on an empty box takes the last chip off, as every
            // address line has done since the first one.
            if (e.key === 'Backspace' && !q && chosen.length) {
              onChange(chosen.slice(0, -1));
            }
          }}
          placeholder={chosen.length ? '' : placeholder}
          className="min-w-[140px] flex-1 border-0 bg-transparent p-1 text-sm outline-none placeholder:text-slate-400"
        />
      </div>

      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {matches.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-slate-400">
              {directory.length === 0
                ? 'Loading people…'
                : 'Nobody else matches that.'}
            </p>
          )}
          {matches.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => add(p)}
              className={cn(
                'flex w-full items-center gap-2.5 px-3 py-2 text-left transition',
                'hover:bg-slate-50 dark:hover:bg-slate-800/60',
              )}
            >
              <Avatar name={p.name} id={p.id} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-slate-800 dark:text-slate-100">
                  {p.name}
                </div>
                <div className="truncate text-xs text-slate-400">
                  {p.username}
                </div>
              </div>
              <Search className="h-3.5 w-3.5 text-slate-300" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
