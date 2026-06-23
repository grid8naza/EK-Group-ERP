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
  /** sm | md | lg | xl */
  width?: 'sm' | 'md' | 'lg' | 'xl';
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const WIDTHS: Record<NonNullable<DrawerProps['width']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
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
}: DrawerProps) {
  // Close on Escape; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

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

      {/* Panel (slides in from the right) */}
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'absolute right-0 top-0 flex h-full w-full flex-col bg-slate-50 shadow-2xl transition-transform duration-300 ease-out dark:bg-slate-950',
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

/** Footer for read-only (view) drawers: a single Close button. */
export function CloseFooter({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-end">
      <button type="button" className="btn-secondary" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

interface DrawerFooterProps {
  onCancel: () => void;
  onSave: () => void;
  onSaveNew?: () => void;
  saving?: boolean;
  saveLabel?: string;
}

export function DrawerFooter({
  onCancel,
  onSave,
  onSaveNew,
  saving,
  saveLabel = 'Save',
}: DrawerFooterProps) {
  return (
    <div className="flex items-center justify-end gap-2">
      <button type="button" className="btn-secondary" onClick={onCancel}>
        Cancel
      </button>
      {onSaveNew && (
        <button
          type="button"
          className="btn-secondary"
          onClick={onSaveNew}
          disabled={saving}
        >
          Save &amp; New
        </button>
      )}
      <button
        type="button"
        className="btn-success"
        onClick={onSave}
        disabled={saving}
      >
        {saving ? 'Saving...' : saveLabel}
      </button>
    </div>
  );
}
