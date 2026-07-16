import type { CSSProperties } from 'react';
import { cn } from './utils';
import type { WidgetAccent, WidgetStyle } from './types';

/**
 * Maps a widget's optional WidgetStyle to the classes + inline styles the
 * renderer applies. Shared by the dashboard widget renderer (WidgetView) and
 * the builder's live preview so both look identical. Unset fields fall back to
 * the standard card look.
 */

// Soft accent tints for widget swatches. The stored key ('blue', 'emerald', …)
// is unchanged; only the display swatch is restyled to the evergreen system.
export const WIDGET_ACCENTS: { key: WidgetAccent; label: string; chip: string }[] = [
  { key: 'blue', label: 'Brand', chip: 'bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-400' },
  { key: 'emerald', label: 'Emerald', chip: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400' },
  { key: 'violet', label: 'Violet', chip: 'bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-400' },
  { key: 'amber', label: 'Amber', chip: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400' },
  { key: 'rose', label: 'Rose', chip: 'bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400' },
  { key: 'slate', label: 'Slate', chip: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
];

export const FONT_FAMILIES = [
  { key: 'sans', label: 'Sans' },
  { key: 'serif', label: 'Serif' },
  { key: 'mono', label: 'Mono' },
] as const;
export const VALUE_SIZES = [
  { key: 'sm', label: 'Small' },
  { key: 'md', label: 'Medium' },
  { key: 'lg', label: 'Large' },
  { key: 'xl', label: 'Extra large' },
] as const;
export const VALUE_WEIGHTS = [
  { key: 'normal', label: 'Normal' },
  { key: 'medium', label: 'Medium' },
  { key: 'semibold', label: 'Semibold' },
  { key: 'bold', label: 'Bold' },
] as const;
export const WIDGET_SHAPES = [
  { key: 'rounded', label: 'Rounded' },
  { key: 'soft', label: 'Soft' },
  { key: 'square', label: 'Square' },
  { key: 'pill', label: 'Pill' },
] as const;

const SHAPE: Record<NonNullable<WidgetStyle['shape']>, string> = {
  rounded: 'rounded-2xl',
  soft: 'rounded-xl',
  square: 'rounded-md',
  pill: 'rounded-[2rem]',
};
const FONT_FAMILY: Record<NonNullable<WidgetStyle['fontFamily']>, string> = {
  sans: 'font-sans',
  serif: 'font-serif',
  mono: 'font-mono',
};
const VALUE_SIZE: Record<NonNullable<WidgetStyle['fontSize']>, string> = {
  sm: 'text-2xl',
  md: 'text-3xl',
  lg: 'text-4xl',
  xl: 'text-5xl',
};
const VALUE_WEIGHT: Record<NonNullable<WidgetStyle['fontWeight']>, string> = {
  normal: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold',
  bold: 'font-bold',
};

export interface ResolvedWidgetStyle {
  containerClass: string;
  containerStyle: CSSProperties;
  accentChip: string;
  valueClass: string;
  valueStyle: CSSProperties;
}

export function resolveWidgetStyle(s?: WidgetStyle | null): ResolvedWidgetStyle {
  const border = s?.border !== false;
  const shadow = s?.shadow !== false;
  const accent =
    WIDGET_ACCENTS.find((a) => a.key === s?.accent) ?? WIDGET_ACCENTS[0];
  return {
    containerClass: cn(
      'h-full p-5',
      SHAPE[s?.shape ?? 'rounded'],
      border && 'border border-slate-200 dark:border-slate-800',
      shadow && 'shadow-sm',
      // Custom background wins; otherwise the standard light/dark card.
      !s?.background && 'bg-white dark:bg-slate-900',
      s?.fontFamily && FONT_FAMILY[s.fontFamily],
    ),
    containerStyle: s?.background ? { backgroundColor: s.background } : {},
    accentChip: accent.chip,
    valueClass: cn(
      VALUE_SIZE[s?.fontSize ?? 'md'],
      VALUE_WEIGHT[s?.fontWeight ?? 'bold'],
    ),
    valueStyle: s?.valueColor ? { color: s.valueColor } : {},
  };
}
