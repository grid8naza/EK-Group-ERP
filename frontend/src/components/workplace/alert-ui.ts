import {
  AlertTriangle,
  Banknote,
  Bell,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Mail,
  PackageMinus,
  type LucideIcon,
} from 'lucide-react';
import type { AlertCategory, AlertPriority } from '@/lib/types';

/**
 * What the bell and the Alerts screen have to agree about.
 *
 * In their own module rather than exported from either: both need these, and
 * having one import the other for a constant is how a cycle starts — the one
 * that loses the race reads the constant before it is initialised, which fails
 * at first render rather than at build. (Learned on TaskScreen; see task-ui.ts.)
 */

export interface CategoryMeta {
  label: string;
  Icon: LucideIcon;
  /** Tint for the icon badge — the category's colour, not the priority's. */
  tint: string;
}

/**
 * The categories, in the order the filter offers them: what asks something of
 * you first, what merely tells you last.
 */
export const CATEGORY_ORDER: AlertCategory[] = [
  'APPROVAL',
  'TASK',
  'STOCK',
  'EXPIRY',
  'PAYMENT',
  'LEAVE',
  'MESSAGE',
  'SYSTEM',
];

export const CATEGORY: Record<AlertCategory, CategoryMeta> = {
  APPROVAL: {
    label: 'Approvals',
    Icon: CheckCircle2,
    tint: 'bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300',
  },
  TASK: {
    label: 'Tasks',
    Icon: ClipboardList,
    tint: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  },
  STOCK: {
    label: 'Stock',
    Icon: PackageMinus,
    tint: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  },
  EXPIRY: {
    label: 'Expiry',
    Icon: CalendarClock,
    tint: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  },
  PAYMENT: {
    label: 'Payments',
    Icon: Banknote,
    tint: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  },
  LEAVE: {
    label: 'Leave',
    Icon: CalendarClock,
    tint: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  },
  MESSAGE: {
    label: 'Messages',
    Icon: Mail,
    tint: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  },
  SYSTEM: {
    label: 'System',
    Icon: Bell,
    tint: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  },
};

/** Falls back rather than crashing on a category this build has not heard of. */
export const categoryMeta = (category: AlertCategory): CategoryMeta =>
  CATEGORY[category] ?? {
    label: 'Alerts',
    Icon: AlertTriangle,
    tint: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  };

/**
 * How loudness paints a row. Only the top two carry a colour — if every alert
 * were tinted the tint would say nothing, which is the same rule the broadcast
 * feed follows.
 */
export const PRIORITY_ROW: Record<AlertPriority, string> = {
  NORMAL: '',
  IMPORTANT: 'border-l-2 border-l-amber-400',
  URGENT: 'border-l-2 border-l-rose-500',
};

export const PRIORITY_TAG: Record<AlertPriority, string> = {
  NORMAL: '',
  IMPORTANT:
    'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  URGENT: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
};
