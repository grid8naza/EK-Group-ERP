/**
 * The small things every printed document needs: escaping, a figure, a date,
 * and a window to print in.
 *
 * Documents here are built as HTML strings in their own window rather than as
 * components on the screen, because what matters is what leaves the printer and
 * a layout inherited from the application's stylesheet is at the mercy of every
 * later change to it. That leaves these four to be shared rather than written
 * out again in each one.
 */

import { formatDayMonthYear } from './utils';

/** 1234.5 → "1,234.50", grouped the Indian way — 12,34,567.00. */
export const money = (v: number) =>
  (v || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * Text going into a document. Everything printed passes through this: a ledger
 * named "Repairs & Maintenance" or a narration with a < in it would otherwise
 * be read as markup and silently swallow the rest of the line.
 */
export const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** An ISO date as it is read here: 10/08/2026. Blank stays blank. */
export const fmtDate = (iso?: string | null) =>
  iso ? formatDayMonthYear(iso.slice(0, 10)) : '';

/**
 * Open a print window and write a built document into it.
 *
 * Called straight from the click, with nothing awaited first — a window opened
 * after an await is a pop-up as far as the browser is concerned, and is blocked.
 * Returns false where it was blocked anyway, for the caller to say so.
 */
export function openPrintWindow(
  html: string,
  width = 900,
  height = 1000,
): boolean {
  const w = window.open('', '_blank', `width=${width},height=${height}`);
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
