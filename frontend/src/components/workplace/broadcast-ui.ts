import type { BroadcastPriority } from '@/lib/types';

/**
 * What the composer and the feed have to agree about.
 *
 * In their own module rather than exported from either screen: both need these,
 * and having one screen import the other for a constant is how a cycle starts —
 * the screen that loses the race reads the constant before it is initialised,
 * which fails at first render rather than at build.
 */

/** The three loudnesses, quietest first — the order they are offered in. */
export const PRIORITIES: {
  value: BroadcastPriority;
  label: string;
  hint: string;
}[] = [
  { value: 'NORMAL', label: 'Normal', hint: 'Ordinary news' },
  { value: 'IMPORTANT', label: 'Important', hint: 'Worth stopping for' },
  { value: 'URGENT', label: 'Urgent', hint: 'Now, and it says so' },
];

/**
 * How each loudness paints a card.
 *
 * Only URGENT and IMPORTANT carry a colour. If every announcement were tinted,
 * the tint would say nothing — the quiet default is what makes the loud ones
 * carry.
 */
export const PRIORITY_CARD: Record<BroadcastPriority, string> = {
  NORMAL: 'border-slate-200 dark:border-slate-800',
  IMPORTANT:
    'border-amber-300 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20',
  URGENT:
    'border-rose-300 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/20',
};

export const PRIORITY_TAG: Record<BroadcastPriority, string> = {
  NORMAL: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  IMPORTANT:
    'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  URGENT: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
};

/** "Shows until 20 Aug", "Expired", "Until dismissed" — the life left in it. */
export function expiryLabel(
  expiresAt: string | null,
  hasExpired: boolean,
): string {
  if (!expiresAt) return 'Until dismissed';
  if (hasExpired) return 'Expired';
  const d = new Date(expiresAt);
  const days = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date().setHours(0, 0, 0, 0)) /
      86_400_000,
  );
  if (days <= 0) return 'Shows until today';
  if (days === 1) return 'Shows until tomorrow';
  return `Shows until ${d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
  })}`;
}
