'use client';

import { useEffect, useMemo, useState } from 'react';
import { Eye, FileText, Printer, Sheet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from './Badge';
import {
  colPercent,
  reportColumns,
  selectColumns,
  headerPlan,
  type Cell,
  type ReportBlock,
  type ReportColumn,
  type SummaryItem,
} from '@/lib/reportDoc';

/**
 * Manages a report's user-chosen visible columns. Returns the `hidden` set (for
 * ColumnToggle), a `toggle` handler, and `selected` (the columns/weights/cells
 * for the visible subset). Hidden columns are remembered per report via
 * localStorage (keyed by `storageKey`, usually the route), and at least one
 * column is always kept visible.
 */
export function useReportColumns<T>(
  storageKey: string,
  all: readonly ReportColumn<T>[],
) {
  const lsKey = `report.hiddenColumns.${storageKey}`;
  // Start empty so the server and first client render match, then load the
  // saved selection after mount (avoids a hydration mismatch).
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(lsKey);
      setHidden(raw ? new Set(JSON.parse(raw) as string[]) : new Set());
    } catch {
      setHidden(new Set());
    }
  }, [lsKey]);

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        // Keep at least one column visible.
        if (all.length - next.size <= 1) return prev;
        next.add(key);
      }
      try {
        window.localStorage.setItem(lsKey, JSON.stringify([...next]));
      } catch {
        /* ignore quota / privacy-mode failures */
      }
      return next;
    });

  const selected = useMemo(() => selectColumns(all, hidden), [all, hidden]);
  return { hidden, toggle, selected };
}

interface ReportViewProps {
  columns: readonly string[];
  weights: readonly number[];
  blocks: ReportBlock[];
  loading?: boolean;
  /** Column index rendered as an Active/Inactive badge. */
  statusCol?: number;
  /** Column index rendered in bold (e.g. the name). */
  boldCol?: number;
  /** Prepend a "Sl. No" column, numbered per table (per parent group). */
  serial?: boolean;
  /** Totals shown in a summary strip under the report. */
  summary?: SummaryItem[];
  /** Column indices to right-align. Columns whose cells are raw numbers are
   *  right-aligned automatically regardless. */
  numericCols?: number[];
  /** Optional two-tier header: group label + lower-row sub-header per visible
   *  column, parallel to `columns`. */
  groups?: (string | undefined)[];
  subHeaders?: (string | undefined)[];
  emptyText?: string;
}

const fmt = (v: Cell) => (typeof v === 'number' ? v.toLocaleString() : String(v));

// shadcn-style column header: no filled band — just muted text on a white
// (sticky-safe) surface with a single hairline underneath.
const HEAD_ROW_CLASS =
  'border-b border-slate-200 bg-white text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500';

/** On-screen grouped report: centered block headings, left sub-headings, and
 *  fixed-width tables with centered column headers — matching the exports. */
export function ReportView({
  columns,
  weights,
  blocks,
  loading,
  statusCol,
  boldCol,
  serial,
  summary,
  numericCols,
  groups,
  subHeaders,
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

  // Effective columns/weights + shifted status/bold indices when a serial
  // column is prepended.
  const eff = reportColumns({ columns, weights, serial });
  // Two-tier header (group labels above Price/% sub-columns) when the report
  // declares column groups; otherwise a single header row.
  const plan = headerPlan(columns, groups, subHeaders, serial);
  const shift = serial ? 1 : 0;
  const statusColX = statusCol == null ? undefined : statusCol + shift;
  const boldColX = boldCol == null ? undefined : boldCol + shift;
  // Output column indices to right-align: flagged numeric columns plus any
  // whose first data cell is a raw number.
  const firstRow = blocks
    .flatMap((b) => b.tables)
    .find((t) => t.rows.length)?.rows[0];
  const numericColX = new Set(
    [
      ...(numericCols ?? []),
      ...(firstRow
        ? firstRow.flatMap((v, i) => (typeof v === 'number' ? [i] : []))
        : []),
    ].map((i) => i + shift),
  );

  // Header cells align with their column's data: numeric → right, the serial
  // column → center, everything else → left.
  const headAlign = (i: number) =>
    numericColX.has(i)
      ? 'text-right'
      : serial && i === 0
        ? 'text-center'
        : 'text-left';

  const table = (
    t: ReportBlock['tables'][number],
    key: string,
    hasHeading: boolean,
  ) => (
    <div key={key}>
      <table className="w-full table-fixed text-left text-sm">
        <colgroup>
          {eff.columns.map((col, i) => (
            <col key={col} style={{ width: colPercent(eff.weights, i) }} />
          ))}
        </colgroup>
        {/* Column header sits just below the sticky block heading (h-10) when
            the block has one, otherwise pins to the top. */}
        <thead className={cn('sticky z-10', hasHeading ? 'top-10' : 'top-0')}>
          {plan ? (
            <>
              <tr className={HEAD_ROW_CLASS}>
                {plan.top.map((c, i) => (
                  <th
                    key={i}
                    colSpan={c.colspan}
                    rowSpan={c.rowspan}
                    className="px-3 py-2 text-center"
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
              <tr className={HEAD_ROW_CLASS}>
                {plan.bottom.map((s, i) => (
                  <th key={i} className={cn('px-3 py-2', headAlign(i))}>
                    {s}
                  </th>
                ))}
              </tr>
            </>
          ) : (
            <tr className={HEAD_ROW_CLASS}>
              {eff.columns.map((col, i) => (
                <th key={col} className={cn('px-3 py-2', headAlign(i))}>
                  {col}
                </th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {t.rows.map((row, ri) => (
            <tr
              key={ri}
              className={cn(
                'border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40',
                t.shade?.[ri] &&
                  'bg-slate-50/80 dark:bg-slate-800/40',
              )}
            >
              {(serial ? [ri + 1, ...row] : row).map((v, ci) =>
                serial && ci === 0 ? (
                  <td
                    key={ci}
                    className="px-3 py-2 text-center tabular-nums text-slate-500 dark:text-slate-400"
                  >
                    {ri + 1}
                  </td>
                ) : ci === statusColX ? (
                  <td key={ci} className="px-3 py-2">
                    <Badge color={String(v) === 'Active' ? 'green' : 'slate'}>
                      {String(v)}
                    </Badge>
                  </td>
                ) : (
                  <td
                    key={ci}
                    className={cn(
                      'break-words px-3 py-2',
                      numericColX.has(ci) && 'text-right tabular-nums',
                      ci === boldColX
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
    <div className="pt-4">
      {blocks.map((b, bi) => (
        <div key={bi} className="mb-6">
          {b.heading && (
            <h2 className="sticky top-0 z-20 flex h-10 items-center justify-center gap-2 border-b border-slate-200 bg-white text-base font-bold text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
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
              {table(t, `${bi}-${ti}`, !!b.heading)}
            </div>
          ))}
        </div>
      ))}

      {summary && summary.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900/50">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Summary
          </span>
          {summary.map((s) => (
            <span key={s.label} className="text-slate-600 dark:text-slate-300">
              {s.label}:{' '}
              <span className="font-semibold text-slate-800 dark:text-slate-100">
                {s.value.toLocaleString()}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
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
