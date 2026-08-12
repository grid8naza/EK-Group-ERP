'use client';

import { API_URL } from '@/lib/api';
import { cn } from '@/lib/utils';

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
