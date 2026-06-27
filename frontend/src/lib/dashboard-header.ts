import type { CSSProperties } from 'react';
import { cn } from './utils';
import type { DashboardHeaderStyle, DashboardHeaderTheme } from './types';

/**
 * Maps a dashboard's optional header style to the classes + inline styles the
 * banner applies. Shared by the runtime dashboard page and the admin "Design
 * Header" drawer's live preview so both look identical. Unset fields fall back
 * to the default brand-blue gradient and the standard subtitle.
 */

export const DEFAULT_HEADER_SUBTITLE =
  'Drag widgets by their handle to arrange your personal layout.';

// Preset gradients. The class strings are literal so Tailwind keeps them.
export const HEADER_THEMES: {
  key: Exclude<DashboardHeaderTheme, 'custom'>;
  label: string;
  gradient: string; // bg-gradient-to-r pair
  swatch: string; // small preview chip in the picker
  labelClass: string; // module-label tint
  subClass: string; // subtitle tint
}[] = [
  { key: 'blue', label: 'Blue', gradient: 'from-brand-600 to-brand-500', swatch: 'from-brand-600 to-brand-500', labelClass: 'text-brand-100', subClass: 'text-brand-50' },
  { key: 'emerald', label: 'Emerald', gradient: 'from-emerald-600 to-emerald-500', swatch: 'from-emerald-600 to-emerald-500', labelClass: 'text-emerald-100', subClass: 'text-emerald-50' },
  { key: 'violet', label: 'Violet', gradient: 'from-violet-600 to-violet-500', swatch: 'from-violet-600 to-violet-500', labelClass: 'text-violet-100', subClass: 'text-violet-50' },
  { key: 'amber', label: 'Amber', gradient: 'from-amber-500 to-orange-500', swatch: 'from-amber-500 to-orange-500', labelClass: 'text-amber-50', subClass: 'text-amber-50' },
  { key: 'rose', label: 'Rose', gradient: 'from-rose-600 to-rose-500', swatch: 'from-rose-600 to-rose-500', labelClass: 'text-rose-100', subClass: 'text-rose-50' },
  { key: 'slate', label: 'Slate', gradient: 'from-slate-700 to-slate-600', swatch: 'from-slate-700 to-slate-600', labelClass: 'text-slate-300', subClass: 'text-slate-200' },
];

export const HEADER_THEME_OPTIONS = [
  ...HEADER_THEMES.map((t) => ({ value: t.key, label: t.label })),
  { value: 'custom', label: 'Custom…' },
];

export const HEADER_SIZES = [
  { key: 'sm', label: 'Compact' },
  { key: 'md', label: 'Standard' },
  { key: 'lg', label: 'Tall' },
] as const;

export const HEADER_ALIGNMENTS = [
  { key: 'left', label: 'Left' },
  { key: 'center', label: 'Center' },
] as const;

const PAD: Record<NonNullable<DashboardHeaderStyle['size']>, string> = {
  sm: 'p-4 sm:p-5',
  md: 'p-6 sm:p-8',
  lg: 'p-8 sm:p-12',
};

const CUSTOM_DEFAULT_FROM = '#2563eb'; // brand-600
const CUSTOM_DEFAULT_TO = '#3b82f6'; // brand-500

export interface ResolvedHeader {
  /** Classes for the banner container (gradient for presets, none for custom). */
  containerClass: string;
  /** Inline background for custom themes; empty for presets. */
  containerStyle: CSSProperties;
  labelClass: string;
  subtitleClass: string;
  padClass: string;
  align: 'left' | 'center';
  pattern: boolean;
  subtitle: string;
}

export function resolveDashboardHeader(
  h?: DashboardHeaderStyle | null,
): ResolvedHeader {
  const theme = h?.theme ?? 'blue';
  const size = h?.size ?? 'md';
  const align = h?.align ?? 'left';
  const pattern = h?.pattern !== false;
  const subtitle =
    h?.subtitle && h.subtitle.trim() ? h.subtitle : DEFAULT_HEADER_SUBTITLE;
  const padClass = PAD[size];

  if (theme === 'custom') {
    const from = h?.gradientFrom || CUSTOM_DEFAULT_FROM;
    const to = h?.gradientTo || CUSTOM_DEFAULT_TO;
    return {
      containerClass: 'relative text-white',
      containerStyle: {
        background: h?.solid ? from : `linear-gradient(to right, ${from}, ${to})`,
      },
      labelClass: 'text-white/80',
      subtitleClass: 'text-white/90',
      padClass,
      align,
      pattern,
      subtitle,
    };
  }

  const preset = HEADER_THEMES.find((t) => t.key === theme) ?? HEADER_THEMES[0];
  return {
    containerClass: cn('relative bg-gradient-to-r text-white', preset.gradient),
    containerStyle: {},
    labelClass: preset.labelClass,
    subtitleClass: preset.subClass,
    padClass,
    align,
    pattern,
    subtitle,
  };
}
