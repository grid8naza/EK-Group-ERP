'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Eye, FileText, Printer, Sheet } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  /** Column index rendered in the primary text colour but NOT bolded. */
  darkCol?: number;
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
  /**
   * Let the reader fold a section (block heading) or one of its tables
   * (sub-heading) away. On-screen only — an export always carries everything,
   * since a printed report the reader cannot unfold is just an incomplete one.
   *
   * Off by default: a chevron on every heading is noise in a report short
   * enough to take in at once.
   */
  collapsible?: boolean;
}

const fmt = (v: Cell) => (typeof v === 'number' ? v.toLocaleString() : String(v));

// shadcn-style column header: no filled band — just muted text on a white
// (sticky-safe) surface with a single hairline underneath.
const HEAD_ROW_CLASS =
  'border-b border-slate-200 bg-white text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500';

/** Soft-filled status pill with a leading status dot (green when Active). */
function StatusPill({ value }: { value: string }) {
  const active = value === 'Active';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        active
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300',
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          active ? 'bg-emerald-500' : 'bg-slate-400',
        )}
      />
      {value}
    </span>
  );
}

/**
 * A heading that can be folded away, or just the heading when it cannot.
 *
 * The chevron is part of the clickable heading rather than a control beside it,
 * so the whole line is the target — a chevron alone is a small thing to hit in
 * a report of forty of them.
 */
function Fold({
  on,
  shut,
  onToggle,
  label,
  children,
}: {
  on: boolean;
  shut: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  if (!on) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!shut}
      title={shut ? `Show ${label}` : `Hide ${label}`}
      className="flex items-center gap-1 rounded text-left hover:text-brand-600 dark:hover:text-brand-400"
    >
      <ChevronDown
        className={cn('h-4 w-4 shrink-0 transition-transform', shut && '-rotate-90')}
      />
      {children}
    </button>
  );
}

/** On-screen grouped report: centered block headings, left sub-headings, and
 *  fixed-width tables with centered column headers — matching the exports. */
export function ReportView({
  columns,
  weights,
  blocks,
  loading,
  statusCol,
  boldCol,
  darkCol,
  serial,
  summary,
  numericCols,
  groups,
  subHeaders,
  emptyText = 'No records found.',
  collapsible = false,
}: ReportViewProps) {
  const total = blocks.reduce(
    (n, b) => n + b.tables.reduce((m, t) => m + t.rows.length, 0),
    0,
  );

  // Everything starts open, and only what the reader folds is remembered —
  // keyed by heading text rather than index so the set survives a filter change
  // that reorders the blocks.
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const fold = (key: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  /** Fold or unfold a set of headings together. */
  const foldAll = (keys: string[], shut: boolean) =>
    setFolded((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (shut) next.add(k);
        else next.delete(k);
      }
      return next;
    });

  const keyOfBlock = (b: ReportBlock, bi: number) => b.heading ?? `#${bi}`;
  const keyOfTable = (
    blockKey: string,
    t: ReportBlock['tables'][number],
    ti: number,
  ) => `${blockKey}/${t.subheading ?? ti}`;
  // Sections collapse as one thing; "collapse all" therefore means the section
  // headings, which takes the whole report down to its four or five lines.
  const sectionKeys = blocks.map(keyOfBlock);

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
  const darkColX = darkCol == null ? undefined : darkCol + shift;
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

  // Header cells align with their column's data: numeric and status → right,
  // everything else (including the serial column) → left.
  const headAlign = (i: number) =>
    numericColX.has(i) || i === statusColX ? 'text-right' : 'text-left';

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
        <thead className={cn('sticky z-10', hasHeading ? 'top-11' : 'top-0')}>
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
                  <th key={i} className={cn('px-3 py-2.5', headAlign(i))}>
                    {s}
                  </th>
                ))}
              </tr>
            </>
          ) : (
            <tr className={HEAD_ROW_CLASS}>
              {eff.columns.map((col, i) => (
                <th key={col} className={cn('px-3 py-2.5', headAlign(i))}>
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
                'border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-100/70 dark:border-slate-800/60 dark:hover:bg-slate-800/50',
                // Zebra striping — even rows carry a faint neutral tint.
                ri % 2 === 1 && 'bg-slate-50/70 dark:bg-slate-900/40',
                // A level-1 row (e.g. a group heading among its members). Last,
                // so it wins over the zebra tint — and matching what print and
                // PDF already did with the same flag, which on screen did
                // nothing at all until now.
                t.shade?.[ri] &&
                  'bg-emerald-50 font-semibold dark:bg-emerald-950/30',
              )}
            >
              {(serial ? [ri + 1, ...row] : row).map((v, ci) =>
                serial && ci === 0 ? (
                  <td
                    key={ci}
                    className="px-3 py-3 tabular-nums text-slate-400 dark:text-slate-500"
                  >
                    {ri + 1}
                  </td>
                ) : ci === statusColX ? (
                  <td key={ci} className="px-3 py-3 text-right">
                    <StatusPill value={String(v)} />
                  </td>
                ) : (
                  <td
                    key={ci}
                    className={cn(
                      'break-words px-3 py-3',
                      numericColX.has(ci) && 'text-right tabular-nums',
                      ci === boldColX
                        ? 'font-semibold text-slate-900 dark:text-slate-100'
                        : ci === darkColX
                          ? 'text-slate-900 dark:text-slate-100'
                          : 'text-slate-600 dark:text-slate-300',
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
      {collapsible && sectionKeys.length > 0 && (
        <div className="mb-1 flex justify-end gap-3 text-xs">
          <button
            type="button"
            onClick={() => foldAll(sectionKeys, false)}
            className="text-slate-500 hover:text-brand-600 dark:text-slate-400"
          >
            Expand all
          </button>
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <button
            type="button"
            onClick={() => foldAll(sectionKeys, true)}
            className="text-slate-500 hover:text-brand-600 dark:text-slate-400"
          >
            Collapse all
          </button>
        </div>
      )}
      {blocks.map((b, bi) => {
        const blockKey = keyOfBlock(b, bi);
        const blockShut = collapsible && folded.has(blockKey);
        // The groups inside this section, so it can be taken down to an
        // outline of its own headings without touching the rest of the report.
        const innerKeys = b.tables
          .map((t, ti) => (t.subheading ? keyOfTable(blockKey, t, ti) : null))
          .filter((k): k is string => !!k);
        const innerShut =
          innerKeys.length > 0 && innerKeys.every((k) => folded.has(k));
        return (
          <div key={bi} className="mb-6">
            {b.heading && (
              <h2 className="sticky top-0 z-20 flex h-11 items-center gap-2 bg-white text-lg font-bold text-slate-900 dark:bg-slate-900 dark:text-slate-100">
                <Fold
                  on={collapsible}
                  shut={blockShut}
                  onToggle={() => fold(blockKey)}
                  label={b.heading}
                >
                  {b.heading}
                </Fold>
                {b.count != null && (
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                    {b.count}
                  </span>
                )}
                {collapsible && !blockShut && innerKeys.length > 1 && (
                  <button
                    type="button"
                    onClick={() => foldAll(innerKeys, !innerShut)}
                    className="text-xs font-normal text-slate-400 hover:text-brand-600 dark:text-slate-500"
                  >
                    {innerShut ? 'Expand groups' : 'Collapse groups'}
                  </button>
                )}
              </h2>
            )}
            {!blockShut &&
              b.tables.map((t, ti) => {
                const tableKey = keyOfTable(blockKey, t, ti);
                const shut = collapsible && folded.has(tableKey);
                return (
                  <div key={ti} className="mb-4">
                    {t.subheading && (
                      // A shade deeper and a size up on the block heading: it is
                      // the tier above the group rows inside the table, and the
                      // two read as one level otherwise.
                      <h3 className="mb-1 flex items-center gap-1.5 text-base font-bold text-slate-900 dark:text-slate-100">
                        <Fold
                          on={collapsible}
                          shut={shut}
                          onToggle={() => fold(tableKey)}
                          label={t.subheading}
                        >
                          {t.subheading}
                        </Fold>
                        {t.subcount != null && (
                          <span className="text-sm font-normal text-slate-400">
                            ({t.subcount})
                          </span>
                        )}
                      </h3>
                    )}
                    {!shut && table(t, `${bi}-${ti}`, !!b.heading)}
                  </div>
                );
              })}
          </div>
        );
      })}

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
