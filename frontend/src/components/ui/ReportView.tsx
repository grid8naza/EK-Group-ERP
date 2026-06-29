'use client';

import { Eye, FileText, Printer, Sheet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from './Badge';
import { colPercent, type Cell, type ReportBlock } from '@/lib/reportDoc';

interface ReportViewProps {
  columns: readonly string[];
  weights: readonly number[];
  blocks: ReportBlock[];
  loading?: boolean;
  /** Column index rendered as an Active/Inactive badge. */
  statusCol?: number;
  /** Column index rendered in bold (e.g. the name). */
  boldCol?: number;
  emptyText?: string;
}

const fmt = (v: Cell) => (typeof v === 'number' ? v.toLocaleString() : String(v));

/** On-screen grouped report: centered block headings, left sub-headings, and
 *  fixed-width tables with centered column headers — matching the exports. */
export function ReportView({
  columns,
  weights,
  blocks,
  loading,
  statusCol,
  boldCol,
  emptyText = 'No records found.',
}: ReportViewProps) {
  const total = blocks.reduce(
    (n, b) => n + b.tables.reduce((m, t) => m + t.rows.length, 0),
    0,
  );

  if (loading)
    return <p className="py-12 text-center text-slate-400">Loading…</p>;
  if (total === 0)
    return <p className="py-12 text-center text-slate-400">{emptyText}</p>;

  const table = (rows: Cell[][], key: string) => (
    <div key={key} className="overflow-x-auto">
      <table className="w-full table-fixed text-left text-sm">
        <colgroup>
          {columns.map((col, i) => (
            <col key={col} style={{ width: colPercent(weights, i) }} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-[#efe7db] bg-[#fcfbf8] text-xs font-semibold uppercase tracking-wide text-[#6d6258] dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
            {columns.map((col) => (
              <th key={col} className="px-3 py-2 text-center">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              className="border-b border-slate-100 last:border-0 dark:border-slate-800/60"
            >
              {row.map((v, ci) =>
                ci === statusCol ? (
                  <td key={ci} className="px-3 py-2">
                    <Badge color={String(v) === 'Active' ? 'green' : 'slate'}>
                      {String(v)}
                    </Badge>
                  </td>
                ) : (
                  <td
                    key={ci}
                    className={cn(
                      'px-3 py-2',
                      ci === boldCol
                        ? 'font-medium text-slate-800 dark:text-slate-100'
                        : 'text-slate-700 dark:text-slate-300',
                    )}
                  >
                    {fmt(v)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      {blocks.map((b, bi) => (
        <div key={bi} className="mb-6">
          {b.heading && (
            <h2 className="mb-2 flex items-center justify-center gap-2 border-b-2 border-[#c9b896] pb-1 text-base font-bold text-slate-800 dark:border-slate-700 dark:text-slate-100">
              {b.heading}
              {b.count != null && <Badge color="slate">{b.count}</Badge>}
            </h2>
          )}
          {b.tables.map((t, ti) => (
            <div key={ti} className="mb-4">
              {t.subheading && (
                <h3 className="mb-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
                  {t.subheading}{' '}
                  {t.subcount != null && (
                    <span className="text-slate-400">({t.subcount})</span>
                  )}
                </h3>
              )}
              {table(t.rows, `${bi}-${ti}`)}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

interface ReportExportButtonsProps {
  canPrint: boolean;
  canPdf: boolean;
  canExcel: boolean;
  onPreview: () => void;
  onPrint: () => void;
  onPdf: () => void;
  onExcel: () => void;
  disabled?: boolean;
}

/**
 * Standard report actions. Print Preview is always available (anyone viewing the
 * report can preview it); the separate Print button (and PDF / Excel) are gated
 * by their own user-group privileges.
 */
export function ReportExportButtons({
  canPrint,
  canPdf,
  canExcel,
  onPreview,
  onPrint,
  onPdf,
  onExcel,
  disabled,
}: ReportExportButtonsProps) {
  return (
    <>
      <button className="btn-secondary" onClick={onPreview} disabled={disabled}>
        <Eye className="h-4 w-4" /> Print Preview
      </button>
      {canPrint && (
        <button className="btn-secondary" onClick={onPrint} disabled={disabled}>
          <Printer className="h-4 w-4" /> Print
        </button>
      )}
      {canPdf && (
        <button className="btn-secondary" onClick={onPdf} disabled={disabled}>
          <FileText className="h-4 w-4" /> PDF
        </button>
      )}
      {canExcel && (
        <button className="btn-primary" onClick={onExcel} disabled={disabled}>
          <Sheet className="h-4 w-4" /> Excel
        </button>
      )}
    </>
  );
}
