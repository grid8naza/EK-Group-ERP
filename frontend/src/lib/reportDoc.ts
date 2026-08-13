// Shared report document helpers: Print (print window), PDF (jspdf + autotable)
// and Excel (xlsx) for the inventory reports. A report is modeled as a list of
// blocks; each block has an optional centered heading (e.g. a category) and one
// or more tables, each with an optional left sub-heading (e.g. a group). This
// covers flat lists, one-level grouping, and two-level grouping with one shape.
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Company } from './types';

export type Cell = string | number;
export interface ReportTable {
  subheading?: string;
  subcount?: number;
  rows: Cell[][];
  /** Optional per-row flag; true renders that row with a light highlight
   *  (e.g. primary / level-1 rows). Parallel to `rows`. */
  shade?: boolean[];
}
export interface ReportBlock {
  /**
   * A tier ABOVE the heading, for a report with three levels of grouping (e.g.
   * primary group › schedule › block). Printed once, over the first block that
   * carries it, and again whenever it changes — so consecutive blocks of the
   * same section sit under one banner.
   */
  section?: string;
  heading?: string;
  count?: number;
  tables: ReportTable[];
}
export interface SummaryItem {
  label: string;
  value: number;
}
export interface ReportSpec {
  companyName: string;
  subtitle: string; // e.g. "Items List - 76 items"
  columns: readonly string[];
  weights: readonly number[]; // relative column widths, same length as columns
  blocks: ReportBlock[];
  fileBase: string; // e.g. "items-report"
  /** Prepend a "Sl. No" column, numbered 1…n and reset for each table
   *  (i.e. per parent group). */
  serial?: boolean;
  /** Totals shown in a summary strip at the foot of the report. */
  summary?: SummaryItem[];
  /** Indices (into `columns`) of numeric columns to right-align. Columns whose
   *  cells are raw numbers are right-aligned automatically regardless. */
  numericCols?: readonly number[];
  /** Optional two-tier header: the group label per column and the lower-row
   *  sub-header per column (both parallel to `columns`, no serial). Leave
   *  undefined for the usual single-row header. */
  groups?: readonly (string | undefined)[];
  subHeaders?: readonly (string | undefined)[];
}

/**
 * Column indices (into `spec.columns`, no serial) that should be right-aligned:
 * every column flagged numeric, plus any whose first data cell is a raw number.
 */
function numericColIndices(spec: ReportSpec): Set<number> {
  const set = new Set<number>(spec.numericCols ?? []);
  let firstRow: Cell[] | undefined;
  for (const b of spec.blocks) {
    for (const t of b.tables) {
      if (t.rows.length) {
        firstRow = t.rows[0];
        break;
      }
    }
    if (firstRow) break;
  }
  firstRow?.forEach((v, i) => {
    if (typeof v === 'number') set.add(i);
  });
  return set;
}

/** numericColIndices shifted for a prepended serial column (→ output indices). */
function rightAlignedOutputCols(spec: ReportSpec): Set<number> {
  const shift = spec.serial ? 1 : 0;
  return new Set([...numericColIndices(spec)].map((i) => i + shift));
}

/**
 * A single report column: its header, relative width, and how to pull the cell
 * value from a row. `status` marks the column rendered as an Active/Inactive
 * badge on screen; `bold` marks the emphasised column (e.g. the name). Used with
 * selectColumns() so the user can choose which columns appear — the chosen
 * subset drives the on-screen table AND every export (print / PDF / Excel),
 * since all of them read from the resulting ReportSpec.
 */
export interface ReportColumn<T> {
  key: string;
  header: string;
  weight: number;
  cell: (row: T) => Cell;
  status?: boolean;
  /** The column that names the record: bold, in the primary text colour. */
  bold?: boolean;
  /**
   * Primary text colour WITHOUT the bolding — for a name column in a report
   * whose emphasis belongs to its headings rather than its rows. Ignored on a
   * column already flagged `bold`.
   */
  dark?: boolean;
  /**
   * Numeric column — right-aligned in every output. Set this when the cell is a
   * pre-formatted number string (e.g. money() / qty()); columns that return a
   * raw `number` are detected and right-aligned automatically.
   */
  numeric?: boolean;
  /**
   * Two-tier header: columns sharing the same `group` collapse into one spanning
   * group label on the top header row, with `subHeader` (falling back to
   * `header`) shown on the row beneath. Columns with no `group` span both rows.
   * Only takes effect when the report forwards `groups`/`subHeaders` to the
   * ReportView / ReportSpec.
   */
  group?: string;
  subHeader?: string;
}

export interface SelectedColumns<T> {
  columns: string[];
  weights: number[];
  statusCol?: number;
  boldCol?: number;
  /** Index of the column shown in the primary text colour but not bolded. */
  darkCol?: number;
  /** Indices of the visible columns that are numeric (right-aligned). */
  numericCols: number[];
  /** Build a row's cells for the visible columns, in order. */
  cells: (row: T) => Cell[];
  /** Per-visible-column group label (parallel to `columns`); undefined when the
   *  report declares no grouped headers. */
  groups?: (string | undefined)[];
  /** Per-visible-column lower-row sub-header (parallel to `columns`). */
  subHeaders?: (string | undefined)[];
}

/**
 * Derive the ReportView / ReportSpec inputs from the visible subset of columns
 * (everything not in `hidden`, preserving declaration order).
 */
export function selectColumns<T>(
  all: readonly ReportColumn<T>[],
  hidden: ReadonlySet<string>,
): SelectedColumns<T> {
  const visible = all.filter((c) => !hidden.has(c.key));
  const statusIdx = visible.findIndex((c) => c.status);
  const boldIdx = visible.findIndex((c) => c.bold);
  const darkIdx = visible.findIndex((c) => c.dark && !c.bold);
  const grouped = visible.some((c) => c.group);
  return {
    columns: visible.map((c) => c.header),
    weights: visible.map((c) => c.weight),
    statusCol: statusIdx === -1 ? undefined : statusIdx,
    boldCol: boldIdx === -1 ? undefined : boldIdx,
    darkCol: darkIdx === -1 ? undefined : darkIdx,
    numericCols: visible
      .map((c, i) => (c.numeric ? i : -1))
      .filter((i) => i >= 0),
    cells: (row: T) => visible.map((c) => c.cell(row)),
    groups: grouped ? visible.map((c) => c.group) : undefined,
    subHeaders: grouped
      ? visible.map((c) => c.subHeader ?? c.header)
      : undefined,
  };
}

/** Fixed-decimal formatting for report numbers (thousands separators + `d`
 *  fraction digits). Money uses 2; quantities pass the unit-master decimals. */
export const fixed = (v: number, d: number) =>
  (Number.isFinite(v) ? v : 0).toLocaleString(undefined, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
/** Prices / percentages — always two decimals. */
export const money = (v: number) => fixed(v, 2);
/** A quantity shown with its unit's decimal places (from the Unit master). */
export const qty = (v: number, decimals: number) =>
  fixed(v, Math.max(0, decimals));

const SERIAL_HEAD = 'Sl. No';
const SERIAL_WEIGHT = 6;

/** Columns/weights with the serial column prepended when `serial` is set. */
export function reportColumns(
  spec: Pick<ReportSpec, 'columns' | 'weights' | 'serial'>,
) {
  return spec.serial
    ? {
        columns: [SERIAL_HEAD, ...spec.columns],
        weights: [SERIAL_WEIGHT, ...spec.weights],
      }
    : { columns: spec.columns, weights: spec.weights };
}

export interface HeaderPlan {
  /** Top header row: each cell spans `colspan` columns and `rowspan` rows. */
  top: { label: string; colspan: number; rowspan: number }[];
  /** Lower header row: sub-labels for the grouped columns only, left → right. */
  bottom: string[];
}

/**
 * Build a two-tier header from the visible columns and their per-column group
 * labels. Consecutive columns sharing a group collapse into one spanning cell;
 * ungrouped columns span both rows. Returns null when there are no groups (the
 * caller then renders the usual single header row). `serial` prepends a Sl. No
 * cell spanning both rows. All inputs are the no-serial visible columns.
 */
export function headerPlan(
  columns: readonly string[],
  groups: readonly (string | undefined)[] | undefined,
  subHeaders: readonly (string | undefined)[] | undefined,
  serial?: boolean,
): HeaderPlan | null {
  if (!groups || !groups.some(Boolean)) return null;
  const top: HeaderPlan['top'] = [];
  const bottom: string[] = [];
  if (serial) top.push({ label: SERIAL_HEAD, colspan: 1, rowspan: 2 });
  let i = 0;
  while (i < columns.length) {
    const g = groups[i];
    if (!g) {
      top.push({ label: columns[i], colspan: 1, rowspan: 2 });
      i += 1;
      continue;
    }
    let j = i;
    while (j < columns.length && groups[j] === g) j += 1;
    top.push({ label: g, colspan: j - i, rowspan: 1 });
    for (let k = i; k < j; k += 1) bottom.push(subHeaders?.[k] ?? columns[k]);
    i = j;
  }
  return { top, bottom };
}

export const reportStamp = () => new Date().toISOString().slice(0, 10);

/** Reports show the full (legal) company name; fall back to the display name. */
export function resolveCompanyName(
  companies: Company[] | null | undefined,
  activeCompanyId: number | null,
  fallback?: string | null,
): string {
  const c = (companies ?? []).find((x) => x.id === activeCompanyId);
  return c?.legalName || c?.name || fallback || '';
}

export const colPercent = (weights: readonly number[], i: number) => {
  const total = weights.reduce((a, b) => a + b, 0);
  return `${((weights[i] / total) * 100).toFixed(3)}%`;
};

const fmt = (v: Cell) =>
  typeof v === 'number' ? v.toLocaleString() : String(v);
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// For a direct "Print", the popup prints itself on load, then closes once the
// print dialog is dismissed (printed OR cancelled) via `afterprint` — so no
// preview window is left open.
const autoPrintScript = `<script>
  window.onafterprint = function () { window.close(); };
  setTimeout(function () { window.print(); }, 200);
</script>`;

/**
 * Open a report window. Used for both "Print Preview" (preview only) and "Print"
 * (auto-prints). `allowPrint` controls whether the in-popup Print button shows
 * (gated by the user's Print privilege); `autoPrint` fires the print dialog on
 * open. Returns false if the pop-up was blocked.
 */
export function printReport(
  spec: ReportSpec,
  opts?: { allowPrint?: boolean; autoPrint?: boolean },
): boolean {
  const allowPrint = opts?.allowPrint ?? true;
  const autoPrint = opts?.autoPrint ?? false;
  const { columns, weights } = reportColumns(spec);
  const rightCols = rightAlignedOutputCols(spec);
  const colgroup = `<colgroup>${columns
    .map((_, i) => `<col style="width:${colPercent(weights, i)}">`)
    .join('')}</colgroup>`;
  const plan = headerPlan(
    spec.columns,
    spec.groups,
    spec.subHeaders,
    spec.serial,
  );
  const head = plan
    ? `<thead><tr>${plan.top
        .map(
          (c) =>
            `<th${c.colspan > 1 ? ` colspan="${c.colspan}"` : ''}${
              c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''
            }>${esc(c.label)}</th>`,
        )
        .join('')}</tr><tr>${plan.bottom
        .map((s) => `<th>${esc(s)}</th>`)
        .join('')}</tr></thead>`
    : `<thead><tr>${columns
        .map((c) => `<th>${esc(c)}</th>`)
        .join('')}</tr></thead>`;
  const tableFor = (t: ReportTable) =>
    `<table>${colgroup}${head}<tbody>${t.rows
      .map((r, i) => {
        const cells = spec.serial ? [i + 1, ...r] : r;
        return `<tr${t.shade?.[i] ? ' class="lvl1"' : ''}>${cells
          .map(
            (v, ci) =>
              `<td${rightCols.has(ci) ? ' class="num"' : ''}>${esc(fmt(v))}</td>`,
          )
          .join('')}</tr>`;
      })
      .join('')}</tbody></table>`;
  const summary =
    spec.summary && spec.summary.length
      ? `<div class="summary"><span class="summary-title">Summary</span>${spec.summary
          .map(
            (s) =>
              `<span class="summary-item"><b>${esc(s.label)}:</b> ${s.value.toLocaleString()}</span>`,
          )
          .join('')}</div>`
      : '';
  let printedSection: string | undefined;
  const body = spec.blocks
    .map((b) => {
      // The section banner repeats only when it changes, so a run of blocks in
      // the same section reads as one part of the report.
      const s = b.section && b.section !== printedSection ? b.section : '';
      if (b.section) printedSection = b.section;
      const h = b.heading
        ? `<h2>${esc(b.heading)}${b.count != null ? ` <span class="muted">(${b.count})</span>` : ''}</h2>`
        : '';
      const tables = b.tables
        .map((t) => {
          const sub = t.subheading
            ? `<h3>${esc(t.subheading)}${t.subcount != null ? ` <span class="muted">(${t.subcount})</span>` : ''}</h3>`
            : '';
          return sub + tableFor(t);
        })
        .join('');
      return (s ? `<div class="section">${esc(s)}</div>` : '') + h + tables;
    })
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(spec.subtitle)}</title>
    <style>
      *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact} body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;margin:24px}
      h1{font-size:20px;font-weight:bold;margin:0 0 2px;text-align:center}
      .sub{font-size:14px;margin:0;text-align:center}
      .date{color:#64748b;font-size:12px;margin:2px 0 16px;text-align:center}
      .section{font-size:16px;font-weight:bold;margin:20px 0 2px;text-align:center;letter-spacing:.04em;text-transform:uppercase;color:#0f172a;page-break-after:avoid}
      h2{font-size:14px;margin:18px 0 4px;border-bottom:2px solid #cbd5e1;padding-bottom:2px;text-align:center}
      /* The group heading sits a tier above the sub-group rows, so it carries
         full weight and the darker text — grey read as lighter than the rows
         beneath it, which is the wrong way round. */
      h3{font-size:12px;margin:10px 0 4px;font-weight:bold;color:#0f172a}
      .muted{color:#94a3b8;font-weight:normal}
      table{width:100%;table-layout:fixed;border-collapse:collapse;margin-bottom:8px;font-size:11px}
      th,td{border:1px solid #e2e8f0;padding:4px 6px;text-align:left;overflow-wrap:anywhere;word-break:break-word}
      th{background:#f1f5f9;text-align:center}
      /* Repeat the column headings on every printed page. */
      thead{display:table-header-group}
      /* A level-1 row (e.g. a sub-group heading among its accounts) carries the
         weight as well as the tint, matching the screen view. */
      tr.lvl1 td{background:#eef4f1;font-weight:bold}
      td.num{text-align:right;font-variant-numeric:tabular-nums}
      ${spec.serial ? 'td:first-child{text-align:center}' : ''}
      .summary{margin-top:14px;padding:8px 12px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;display:flex;flex-wrap:wrap;gap:6px 20px;font-size:12px;page-break-inside:avoid}
      .summary-title{font-weight:bold;text-transform:uppercase;letter-spacing:.04em;color:#64748b;margin-right:6px}
      .summary-item b{color:#0f172a}
      .toolbar{display:flex;gap:8px;margin-bottom:14px}
      .toolbar button{padding:6px 16px;font-size:13px;font-family:inherit;border:1px solid #cbd5e1;border-radius:6px;background:#f1f5f9;color:#334155;cursor:pointer}
      .toolbar button.primary{background:#1c463a;border-color:#1c463a;color:#fff}
      /* Page setup: print only the report (hide the toolbar), landscape. */
      @page{size:landscape;margin:10mm}
      @media print{.toolbar{display:none} body{margin:0}}
    </style></head><body>
    <div class="toolbar">
      ${allowPrint ? '<button class="primary" onclick="window.print()">Print</button>' : ''}
      <button onclick="window.close()">Close</button>
    </div>
    <h1>${esc(spec.companyName)}</h1>
    <p class="sub">${esc(spec.subtitle)}</p>
    <p class="date">${new Date().toLocaleString()}</p>
    ${body || '<p>No records match the current filters.</p>'}
    ${summary}
    ${autoPrint ? autoPrintScript : ''}
    </body></html>`;
  const w = window.open('', '_blank', 'width=1100,height=800');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  w.focus();
  return true;
}

export function pdfReport(spec: ReportSpec): void {
  const { columns, weights } = reportColumns(spec);
  const doc = new jsPDF({ orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const cx = pageW / 2;
  const tableWidth = pageW - 30; // left margin 16 + right 14
  const totalW = weights.reduce((a, b) => a + b, 0);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(spec.companyName, cx, 14, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(spec.subtitle, cx, 21, { align: 'center' });
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(new Date().toLocaleString(), cx, 27, { align: 'center' });
  doc.setTextColor(20);

  let y = 34;
  const ensure = (needed: number) => {
    if (y + needed > pageH - 12) {
      doc.addPage();
      y = 16;
    }
  };
  const rightCols = rightAlignedOutputCols(spec);
  const columnStyles: Record<number, { cellWidth: number; halign?: 'center' }> =
    Object.fromEntries(
      columns.map((_, i) => [
        i,
        { cellWidth: (weights[i] / totalW) * tableWidth },
      ]),
    );
  // Serial stays centered; numeric columns are right-aligned in the BODY only
  // (via didParseCell) so headers keep the centered headStyles alignment.
  if (spec.serial) columnStyles[0].halign = 'center';

  // Two-tier header (group labels spanning Price/% sub-columns) when the spec
  // declares column groups; otherwise a single header row.
  const plan = headerPlan(
    spec.columns,
    spec.groups,
    spec.subHeaders,
    spec.serial,
  );
  const pdfHead = plan
    ? [
        plan.top.map((c) => ({
          content: c.label,
          colSpan: c.colspan,
          rowSpan: c.rowspan,
        })),
        plan.bottom.map((s) => ({ content: s })),
      ]
    : [columns as unknown as string[]];

  let pdfSection: string | undefined;
  for (const b of spec.blocks) {
    // Section banner — once per run of blocks that share one (see ReportBlock).
    if (b.section && b.section !== pdfSection) {
      ensure(16);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(b.section.toUpperCase(), cx, y, { align: 'center' });
      y += 6;
    }
    if (b.section) pdfSection = b.section;
    if (b.heading) {
      ensure(12);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(
        `${b.heading}${b.count != null ? `  (${b.count})` : ''}`,
        cx,
        y,
        { align: 'center' },
      );
      y += 5;
    }
    for (const t of b.tables) {
      ensure(10);
      if (t.subheading) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text(
          `${t.subheading}${t.subcount != null ? `  (${t.subcount})` : ''}`,
          16,
          y,
        );
        y += 2;
      }
      autoTable(doc, {
        startY: y,
        head: pdfHead as unknown as string[][],
        body: t.rows.map((r, i) => (spec.serial ? [i + 1, ...r] : r).map(fmt)),
        // Match the HTML report: light beige header, dark slate text, thin tan
        // grid lines, and vertically-centered spanning header cells.
        styles: {
          fontSize: 8,
          cellPadding: 1.5,
          overflow: 'linebreak',
          textColor: [30, 41, 59],
          lineColor: [216, 210, 198],
          lineWidth: 0.1,
        },
        headStyles: {
          fillColor: [243, 236, 224],
          textColor: [30, 41, 59],
          halign: 'center',
          valign: 'middle',
          lineColor: [216, 210, 198],
          lineWidth: 0.1,
        },
        columnStyles,
        margin: { left: 16, right: 14 },
        theme: 'grid',
        tableWidth,
        didParseCell: (d: {
          section: string;
          row: { index: number };
          column: { index: number };
          cell: {
            styles: {
              fillColor?: string | number | number[] | false;
              halign?: string;
              fontStyle?: string;
            };
          };
        }) => {
          if (d.section === 'body' && t.shade?.[d.row.index]) {
            d.cell.styles.fillColor = [247, 235, 215];
            d.cell.styles.fontStyle = 'bold';
          }
          if (d.section === 'body' && rightCols.has(d.column.index))
            d.cell.styles.halign = 'right';
        },
      });
      y =
        (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
          .finalY + 6;
    }
    if (b.heading) y += 1;
  }

  if (spec.summary?.length) {
    ensure(14);
    y += 2;
    doc.setDrawColor(200, 190, 170);
    doc.setFillColor(250, 246, 238);
    doc.rect(16, y - 4, tableWidth, 9, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(90, 80, 70);
    doc.text('SUMMARY', 19, y + 1.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40);
    const line = spec.summary
      .map((s) => `${s.label}: ${s.value.toLocaleString()}`)
      .join('     ');
    doc.text(line, 44, y + 1.5);
  }

  doc.save(`${spec.fileBase}-${reportStamp()}.pdf`);
}

/**
 * Flat worksheet. Optional `sectionLabel`/`headingLabel`/`subheadingLabel`
 * prepend the block's section / heading / table sub-heading as leading columns
 * (e.g. Primary Group, Schedule, Group) so the grouping survives as data a
 * pivot table can work with, rather than as banners a spreadsheet cannot sort.
 */
export function excelReport(
  spec: ReportSpec,
  grouping?: {
    sectionLabel?: string;
    headingLabel?: string;
    subheadingLabel?: string;
  },
): void {
  const { sectionLabel, headingLabel, subheadingLabel } = grouping ?? {};
  // Grouped headers are flattened into single descriptive labels (e.g.
  // "Intercompany Price") so the sheet stays flat, as documented above.
  const colLabels = spec.columns.map((c, i) => {
    const g = spec.groups?.[i];
    return g ? `${g} ${spec.subHeaders?.[i] ?? c}` : c;
  });
  const header = [
    ...(spec.serial ? ['Sl. No'] : []),
    ...(sectionLabel ? [sectionLabel] : []),
    ...(headingLabel ? [headingLabel] : []),
    ...(subheadingLabel ? [subheadingLabel] : []),
    ...colLabels,
  ];
  const rows: Cell[][] = [];
  for (const b of spec.blocks)
    for (const t of b.tables)
      t.rows.forEach((r, i) =>
        rows.push([
          ...(spec.serial ? [i + 1] : []),
          ...(sectionLabel ? [b.section ?? ''] : []),
          ...(headingLabel ? [b.heading ?? ''] : []),
          ...(subheadingLabel ? [t.subheading ?? ''] : []),
          ...r,
        ]),
      );
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');

  // Optional summary sheet with the report totals.
  if (spec.summary?.length) {
    const sumWs = XLSX.utils.aoa_to_sheet([
      ['Summary'],
      ...spec.summary.map((s) => [s.label, s.value]),
    ]);
    XLSX.utils.book_append_sheet(wb, sumWs, 'Summary');
  }

  XLSX.writeFile(wb, `${spec.fileBase}-${reportStamp()}.xlsx`);
}
