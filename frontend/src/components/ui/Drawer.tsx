'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  /** sm | md | lg | xl | full (fullscreen) */
  width?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  children: React.ReactNode;
  footer?: React.ReactNode;
  /**
   * Optional card floated in the blurred backdrop, left of the panel — e.g. a
   * running summary of what's already been entered while adding more. Shown only
   * on large screens (where there's room beside the panel); ignored for `full`.
   */
  aside?: React.ReactNode;
  /**
   * Whether Escape closes this drawer. Set false on an outer drawer while a
   * nested drawer is open, so Escape only dismisses the top-most one.
   */
  closeOnEsc?: boolean;
}

const WIDTHS: Record<NonNullable<DrawerProps['width']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
  full: 'max-w-none', // fullscreen — the panel fills the viewport
};

// Panel widths in rem (matching WIDTHS), used to offset the `aside` card so it
// sits just left of the panel rather than under it.
const PANEL_OFFSET: Record<NonNullable<DrawerProps['width']>, string> = {
  sm: '28rem',
  md: '36rem',
  lg: '48rem',
  xl: '64rem',
  full: '100%',
};

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  icon,
  width = 'md',
  children,
  footer,
  aside,
  closeOnEsc = true,
}: DrawerProps) {
  // Close on Escape; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEsc) onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, closeOnEsc]);

  return (
    <div
      className={cn(
        'fixed inset-0 z-50',
        open ? 'pointer-events-auto' : 'pointer-events-none',
      )}
      aria-hidden={!open}
    >
      {/* Overlay */}
      <div
        className={cn(
          'absolute inset-0 bg-slate-900/50 backdrop-blur-sm transition-opacity duration-300',
          open ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
      />

      {/* Summary card floated in the blurred area, left of the panel. Only on
          large screens with room beside the panel, and never for fullscreen. */}
      {aside && width !== 'full' && (
        <div
          className={cn(
            'absolute inset-y-0 left-0 hidden items-center justify-center p-6 transition-opacity duration-300 lg:flex',
            open ? 'opacity-100' : 'opacity-0',
          )}
          style={{ right: PANEL_OFFSET[width] }}
          onClick={onClose}
        >
          <div
            className="pointer-events-auto max-h-full w-full max-w-md overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {aside}
          </div>
        </div>
      )}

      {/* Panel (slides in from the right) */}
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'absolute right-0 top-0 flex h-full w-full flex-col border-l border-slate-200 bg-slate-50 transition-transform duration-300 ease-out dark:border-slate-800 dark:bg-slate-950',
          WIDTHS[width],
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
          {icon && <span className="text-brand-600">{icon}</span>}
          <div className="min-w-0 flex-1">
            {title && (
              <h2 className="truncate text-lg font-semibold text-slate-900 dark:text-white">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                {subtitle}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {/* Sticky footer */}
        {footer && (
          <div className="border-t border-slate-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** A subtle keyboard-shortcut hint shown next to a button label. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1.5 hidden rounded border border-slate-300/60 px-1 text-[10px] font-normal leading-tight opacity-70 dark:border-slate-600/60 sm:inline">
      {children}
    </span>
  );
}

/** Footer for read-only (view) drawers: a single Close button. Esc also closes. */
export function CloseFooter({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-end">
      <button type="button" className="btn-secondary" onClick={onClose}>
        Close <Kbd>Esc</Kbd>
      </button>
    </div>
  );
}

/** How a save was triggered — decides what the form does after persisting. */
export type SaveMode = 'save' | 'saveClose' | 'saveNew';

interface DrawerFooterProps {
  onCancel: () => void;
  /** Called with the chosen mode. Action dialogs may ignore the argument. */
  onSave: (mode: SaveMode) => void;
  saving?: boolean;
  saveLabel?: string;
  /**
   * Data-entry record forms set this to show the standard four-button set:
   * Save (stay open), Save & New, Save & Close, Cancel. Left false for action
   * dialogs (backup, password, assignments), which keep a single action button.
   */
  dataEntry?: boolean;
  /** Extra content shown at the start of the row (e.g. an "Add line" button). */
  leading?: React.ReactNode;
}

/**
 * Standard drawer footer. For data-entry forms (`dataEntry`) it renders the
 * mandatory buttons in a fixed order on a single line — Save (persists and keeps
 * the form open), Save & New, Save & Close, Cancel. Otherwise it shows a single
 * primary action button next to Cancel. Keyboard shortcuts are surfaced as
 * tooltips (kept off the labels so all four fit on one row).
 */
export function DrawerFooter({
  onCancel,
  onSave,
  saving,
  saveLabel = 'Save',
  dataEntry = false,
  leading,
}: DrawerFooterProps) {
  // App-wide form shortcuts (active while a drawer footer is mounted):
  //   Ctrl/⌘+S        → Save (keeps the form open on data-entry forms)
  //   Ctrl/⌘+Shift+S  → Save & Close (data-entry forms)
  //   Ctrl/⌘+Enter    → Save & New (data-entry forms) / Save otherwise
  //   Esc             → Cancel (handled by the Drawer's own Escape listener)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || saving) return;
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        onSave(e.shiftKey && dataEntry ? 'saveClose' : 'save');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onSave(dataEntry ? 'saveNew' : 'save');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onSave, saving, dataEntry]);

  return (
    <div className="flex flex-nowrap items-center justify-end gap-2">
      {leading && <div className="mr-auto">{leading}</div>}
      <button
        type="button"
        className="btn-success whitespace-nowrap"
        title="Ctrl+S"
        onClick={() => onSave('save')}
        disabled={saving}
      >
        {saving ? 'Saving...' : saveLabel}
      </button>
      {dataEntry && (
        <>
          <button
            type="button"
            className="btn-secondary whitespace-nowrap"
            title="Ctrl+Enter"
            onClick={() => onSave('saveNew')}
            disabled={saving}
          >
            Save &amp; New
          </button>
          <button
            type="button"
            className="btn-secondary whitespace-nowrap"
            title="Ctrl+Shift+S"
            onClick={() => onSave('saveClose')}
            disabled={saving}
          >
            Save &amp; Close
          </button>
        </>
      )}
      <button
        type="button"
        className="btn-secondary whitespace-nowrap"
        title="Esc"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}
