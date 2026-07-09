'use client';

import { useEffect } from 'react';
import { X, Info } from 'lucide-react';
import { mediaUrl } from '@/lib/login-screen';
import { formatDate } from '@/lib/utils';
import type { SoftwareInfo } from '@/lib/software-info';

/** Read-only panel showing the software / licence details. */
export function SoftwareInfoDialog({
  open,
  onClose,
  info,
}: {
  open: boolean;
  onClose: () => void;
  info: SoftwareInfo | null;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const rows: { label: string; value: string }[] = [
    { label: 'Company', value: info?.companyName || '—' },
    { label: 'Address', value: info?.address || '—' },
    { label: 'Email', value: info?.email || '—' },
    { label: 'Contact', value: info?.contactNumber || '—' },
    { label: 'Software', value: info?.softwareName || '—' },
    { label: 'Version', value: info?.softwareVersion || '—' },
    { label: 'Licence key', value: info?.licenceKey || '—' },
    {
      label: 'Subscription expiry',
      value: info?.subscriptionExpiry
        ? formatDate(info.subscriptionExpiry).slice(0, 10)
        : '—',
    },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[#e7ddcb] bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3 border-b border-slate-100 bg-[#fbf9f4] px-5 py-4 dark:border-slate-800 dark:bg-slate-900/60">
          {info?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaUrl(info.logoUrl)}
              alt="Logo"
              className="h-10 w-10 flex-none rounded-lg object-contain"
            />
          ) : (
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-brand-100 text-brand-600 dark:bg-brand-950">
              <Info className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-slate-900 dark:text-slate-100">
              {info?.softwareName || 'Software Information'}
            </h2>
            {info?.softwareVersion && (
              <p className="text-xs text-slate-500">
                Version {info.softwareVersion}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <dl className="divide-y divide-slate-100 px-5 py-2 dark:divide-slate-800">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex items-start justify-between gap-4 py-2.5"
            >
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {r.label}
              </dt>
              <dd className="max-w-[60%] break-words text-right text-sm font-medium text-slate-700 dark:text-slate-200">
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
