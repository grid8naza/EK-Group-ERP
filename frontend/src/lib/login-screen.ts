import type { CSSProperties } from 'react';
import { API_URL } from './api';

/**
 * Shared types + resolver for the customizable login screen. Used by both the
 * Cpanel "Login Screen Setup" editor (live preview) and the real /login page so
 * they render identically. Unset fields fall back to DEFAULT_LOGIN_CONFIG, which
 * reproduces the original hard-coded login look.
 */

export type TextAlign = 'left' | 'center' | 'right';

export interface TextStyle {
  fontFamily?: string; // FONT_OPTIONS value; '' / undefined = inherit
  fontSize?: number; // px
  color?: string; // hex
  bold?: boolean;
  italic?: boolean;
  align?: TextAlign;
}

export type LoginLayout = 'centered' | 'split';

export interface CtaButton {
  label?: string;
  url?: string;
}

export interface LinkConf {
  show?: boolean;
  label?: string;
  url?: string;
}
export type ForgotPassword = LinkConf;

export interface SignUpConf {
  show?: boolean;
  prompt?: string;
  label?: string;
  url?: string;
}

export interface LoginScreenConfig {
  logoUrl?: string | null;
  logoSize?: number; // logo height in px
  heading?: string;
  headingStyle?: TextStyle;
  description?: string;
  descriptionStyle?: TextStyle;
  // Rich-text (WYSIWYG) HTML — when present, takes precedence over the plain
  // text + style for that field on render.
  headingHtml?: string;
  descriptionHtml?: string;
  overlayHeadingHtml?: string;
  overlayTextHtml?: string;
  cardColor?: string; // login card background (hex)
  cardOpacity?: number; // login card fill opacity, 0–100 (100 = solid)
  pageColor?: string; // page background when no media (hex)
  backgroundMediaId?: number | null;
  copyright?: string;
  copyrightStyle?: TextStyle;

  // layout & form
  layout?: LoginLayout;
  formTitle?: string;
  formTitleStyle?: TextStyle;
  usernameLabel?: string;
  passwordLabel?: string;
  submitLabel?: string;
  buttonColor?: string; // submit button (hex); empty = brand
  buttons?: CtaButton[];
  showRememberMe?: boolean;
  rememberMeLabel?: string;
  forgotPassword?: LinkConf;
  secondaryButton?: LinkConf; // e.g. "Sign in with Google" (display-only)
  signUp?: SignUpConf;

  // Layout 2 image-panel overlay
  overlayHeading?: string;
  overlayHeadingStyle?: TextStyle;
  overlayText?: string;
  overlayTextStyle?: TextStyle;
  knowMore?: LinkConf;
}

export const LAYOUT_OPTIONS: {
  value: LoginLayout;
  label: string;
  hint: string;
}[] = [
  {
    value: 'centered',
    label: 'Layout 1 — Centered',
    hint: 'Logo, text and card stacked in the middle.',
  },
  {
    value: 'split',
    label: 'Layout 2 — Split',
    hint: 'Branding panel on the left, login card on the right.',
  },
];

export type LoginMediaKind = 'IMAGE' | 'GIF' | 'VIDEO';

export interface LoginMedia {
  id: number;
  kind: LoginMediaKind;
  url: string;
  originalName: string;
  sizeBytes: number;
  createdAt?: string;
}

export interface LoginScreenData {
  config: LoginScreenConfig | null;
  media: LoginMedia[];
}

// Reproduces today's hard-coded login appearance.
export const DEFAULT_LOGIN_CONFIG: Required<
  Omit<LoginScreenConfig, 'logoUrl' | 'backgroundMediaId'>
> = {
  logoSize: 48,
  heading: 'Welcome to Erp Grid8',
  headingStyle: { fontSize: 24, color: '#0f172a', bold: true, italic: false },
  description: 'Sign in to access your control panel',
  descriptionStyle: {
    fontSize: 14,
    color: '#64748b',
    bold: false,
    italic: false,
  },
  headingHtml: '',
  descriptionHtml: '',
  overlayHeadingHtml: '',
  overlayTextHtml: '',
  cardColor: '#ffffff',
  cardOpacity: 100,
  pageColor: '#f8fafc',
  copyright: 'Erp Grid8 © {year} — Modular ERP',
  copyrightStyle: {
    fontSize: 12,
    color: '#94a3b8',
    bold: false,
    italic: false,
  },

  // layout & form
  layout: 'centered',
  formTitle: '',
  formTitleStyle: { fontSize: 18, color: '#0f172a', bold: true, italic: false },
  usernameLabel: 'Username',
  passwordLabel: 'Password',
  submitLabel: 'Sign In',
  buttonColor: '',
  buttons: [],
  showRememberMe: false,
  rememberMeLabel: 'Remember me',
  forgotPassword: { show: false, label: 'Forgot your password?', url: '#' },
  secondaryButton: { show: false, label: 'Sign in with Google', url: '#' },
  signUp: {
    show: false,
    prompt: "Don't have an account?",
    label: 'Sign up',
    url: '#',
  },

  // Layout 2 image-panel overlay
  overlayHeading: '',
  overlayHeadingStyle: {
    fontSize: 44,
    color: '#ffffff',
    bold: true,
    italic: false,
  },
  overlayText: '',
  overlayTextStyle: {
    fontSize: 16,
    color: '#e5e7eb',
    bold: false,
    italic: false,
  },
  knowMore: { show: false, label: 'Know more', url: '#' },
};

// Curated font list: a few system stacks + Google fonts (loaded on demand).
export const FONT_OPTIONS: {
  value: string;
  label: string;
  stack: string;
  google?: string; // Google family name to load, if any
}[] = [
  { value: '', label: 'Default (theme font)', stack: '' },
  {
    value: 'system',
    label: 'System Sans',
    stack: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  },
  { value: 'arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  {
    value: 'georgia',
    label: 'Georgia',
    stack: 'Georgia, "Times New Roman", serif',
  },
  {
    value: 'times',
    label: 'Times New Roman',
    stack: '"Times New Roman", Times, serif',
  },
  { value: 'courier', label: 'Courier New', stack: '"Courier New", monospace' },
  { value: 'verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  {
    value: 'trebuchet',
    label: 'Trebuchet MS',
    stack: '"Trebuchet MS", sans-serif',
  },
  {
    value: 'roboto',
    label: 'Roboto',
    stack: "'Roboto', sans-serif",
    google: 'Roboto',
  },
  {
    value: 'open-sans',
    label: 'Open Sans',
    stack: "'Open Sans', sans-serif",
    google: 'Open Sans',
  },
  { value: 'lato', label: 'Lato', stack: "'Lato', sans-serif", google: 'Lato' },
  {
    value: 'montserrat',
    label: 'Montserrat',
    stack: "'Montserrat', sans-serif",
    google: 'Montserrat',
  },
  {
    value: 'poppins',
    label: 'Poppins',
    stack: "'Poppins', sans-serif",
    google: 'Poppins',
  },
  {
    value: 'playfair',
    label: 'Playfair Display',
    stack: "'Playfair Display', serif",
    google: 'Playfair Display',
  },
];

const FONT_BY_VALUE = new Map(FONT_OPTIONS.map((f) => [f.value, f]));

export const FONT_SIZE_RANGE = { min: 8, max: 96 };

/** Maps a TextStyle (with a fallback for unset fields) to inline CSS. */
export function resolveTextStyle(
  style?: TextStyle,
  fallback?: TextStyle,
): CSSProperties {
  const s = { ...fallback, ...style };
  const font = s.fontFamily ? FONT_BY_VALUE.get(s.fontFamily) : undefined;
  const css: CSSProperties = {};
  if (font?.stack) css.fontFamily = font.stack;
  if (s.fontSize) css.fontSize = `${s.fontSize}px`;
  if (s.color) css.color = s.color;
  css.fontWeight = s.bold ? 700 : 400;
  css.fontStyle = s.italic ? 'italic' : 'normal';
  if (s.align) css.textAlign = s.align;
  // Honour manual line breaks entered in the editor's multi-line fields.
  css.whiteSpace = 'pre-line';
  return css;
}

/**
 * Turn a hex colour + opacity% into an rgba() string, so a card can be made
 * semi-transparent without fading its contents (as CSS `opacity` would). Falls
 * back to the original value for non-hex input.
 */
export function withAlpha(
  hex: string | undefined,
  opacityPct?: number,
): string {
  const a = Math.max(0, Math.min(100, opacityPct ?? 100)) / 100;
  const h = (hex ?? '#ffffff').trim();
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h);
  if (!m) return h;
  let v = m[1];
  if (v.length === 3)
    v = v
      .split('')
      .map((c) => c + c)
      .join('');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Backend origin (strip the trailing /api) so uploaded files resolve. */
const ORIGIN = API_URL.replace(/\/api\/?$/, '');

/** Absolute URL for an uploaded asset path like /uploads/login-screen/x.png. */
export function mediaUrl(url?: string | null): string {
  if (!url) return '';
  return /^https?:\/\//.test(url) ? url : `${ORIGIN}${url}`;
}

/** Google font families referenced by a config, for a stylesheet <link>. */
export function usedGoogleFonts(config: LoginScreenConfig): string[] {
  const families = new Set<string>();
  for (const st of [
    config.headingStyle,
    config.descriptionStyle,
    config.copyrightStyle,
    config.formTitleStyle,
    config.overlayHeadingStyle,
    config.overlayTextStyle,
  ]) {
    const f = st?.fontFamily ? FONT_BY_VALUE.get(st.fontFamily) : undefined;
    if (f?.google) families.add(f.google);
  }
  return [...families];
}

/** Build the Google Fonts stylesheet href for the given families (or ''). */
export function googleFontsHref(families: string[]): string {
  if (!families.length) return '';
  const params = families
    .map(
      (f) =>
        `family=${encodeURIComponent(f)}:ital,wght@0,400;0,700;1,400;1,700`,
    )
    .join('&');
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

/** Fill an incoming config with defaults so render code can assume presence. */
export function withDefaults(
  config: LoginScreenConfig | null | undefined,
): LoginScreenConfig {
  return { ...DEFAULT_LOGIN_CONFIG, ...(config ?? {}) };
}

/** Resolve the {year} token in copyright text. */
export function formatCopyright(text: string, year: number): string {
  return text.replace(/\{year\}/g, String(year));
}

// WYSIWYG output is rendered with dangerouslySetInnerHTML, and the login page is
// public + the save endpoint is JWT-only, so we sanitize to a small safe subset
// before rendering. Browser-only (uses the DOM); returns '' on the server.
const SANITIZE_ALLOWED_TAGS = new Set([
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'S',
  'SPAN',
  'BR',
  'DIV',
  'P',
  'FONT',
  'SUB',
  'SUP',
]);
const SANITIZE_DANGEROUS_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'LINK',
  'META',
  'FORM',
  'INPUT',
  'BUTTON',
  'SVG',
  'IMG',
  'A',
]);
const SANITIZE_ALLOWED_STYLE = new Set([
  'color',
  'background-color',
  'font-weight',
  'font-style',
  'text-decoration',
  'text-decoration-line',
  'font-family',
  'font-size',
  'text-align',
]);

/**
 * Remove inline `text-align` from rich-text HTML so the field-level alignment
 * (applied to the render container) governs instead of stale inline values.
 * Browser-only; returns the input unchanged on the server.
 */
export function stripTextAlign(html: string): string {
  if (!html || typeof document === 'undefined') return html;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('[style]').forEach((el) => {
    const cleaned = (el.getAttribute('style') || '')
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .filter((d) => d.split(':')[0].trim().toLowerCase() !== 'text-align')
      .join('; ');
    if (cleaned) el.setAttribute('style', cleaned);
    else el.removeAttribute('style');
  });
  return tpl.innerHTML;
}

export function sanitizeHtml(html: string): string {
  if (!html || typeof document === 'undefined') return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = html;

  const clean = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 1) {
        const el = child as HTMLElement;
        if (SANITIZE_DANGEROUS_TAGS.has(el.tagName)) {
          el.remove();
          continue;
        }
        if (!SANITIZE_ALLOWED_TAGS.has(el.tagName)) {
          // Unknown but not dangerous → unwrap, keeping its (cleaned) children.
          clean(el);
          el.replaceWith(...Array.from(el.childNodes));
          continue;
        }
        // Strip every attribute except a filtered inline style.
        for (const attr of Array.from(el.attributes)) {
          if (attr.name.toLowerCase() !== 'style')
            el.removeAttribute(attr.name);
        }
        const style = el.getAttribute('style');
        if (style) {
          const safe = style
            .split(';')
            .map((d) => d.trim())
            .filter(Boolean)
            .filter((d) =>
              SANITIZE_ALLOWED_STYLE.has(d.split(':')[0].trim().toLowerCase()),
            )
            .filter((d) => !/url\s*\(|expression|javascript:/i.test(d))
            .join('; ');
          if (safe) el.setAttribute('style', safe);
          else el.removeAttribute('style');
        }
        clean(el);
      } else if (child.nodeType !== 3) {
        // Drop comments / CDATA / processing instructions.
        child.remove();
      }
    }
  };
  clean(tpl.content);
  return tpl.innerHTML;
}
