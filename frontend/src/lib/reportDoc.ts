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
}
export interface ReportBlock {
  heading?: string;
  count?: number;
  tables: ReportTable[];
}
export interface ReportSpec {
  companyName: string;
  subtitle: string; // e.g. "Items List - 76 items"
  columns: readonly string[];
  weights: readonly number[]; // relative column widths, same length as columns
  blocks: ReportBlock[];
  fileBase: string; // e.g. "items-report"
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

const fmt = (v: Cell) => (typeof v === 'number' ? v.toLocaleString() : String(v));
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Open a print window with the report. Returns false if the pop-up was blocked. */
export function printReport(spec: ReportSpec): boolean {
  const { columns, weights } = spec;
  const colgroup = `<colgroup>${columns
    .map((_, i) => `<col style="width:${colPercent(weights, i)}">`)
    .join('')}</colgroup>`;
  const head = `<thead><tr>${columns
    .map((c) => `<th>${esc(c)}</th>`)
    .join('')}</tr></thead>`;
  const tableFor = (t: ReportTable) =>
    `<table>${colgroup}${head}<tbody>${t.rows
      .map(
        (r) => `<tr>${r.map((v) => `<td>${esc(fmt(v))}</td>`).join('')}</tr>`,
      )
      .join('')}</tbody></table>`;
  const body = spec.blocks
    .map((b) => {
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
      return h + tables;
    })
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(spec.subtitle)}</title>
    <style>
      *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;margin:24px}
      h1{font-size:20px;font-weight:bold;margin:0 0 2px;text-align:center}
      .sub{font-size:14px;margin:0;text-align:center}
      .date{color:#64748b;font-size:12px;margin:2px 0 16px;text-align:center}
      h2{font-size:14px;margin:18px 0 4px;border-bottom:2px solid #c9b896;padding-bottom:2px;text-align:center}
      h3{font-size:12px;margin:10px 0 4px;color:#475569}
      .muted{color:#94a3b8;font-weight:normal}
      table{width:100%;table-layout:fixed;border-collapse:collapse;margin-bottom:8px;font-size:11px}
      th,td{border:1px solid #d8d2c6;padding:4px 6px;text-align:left;overflow-wrap:anywhere}
      th{background:#f3ece0;text-align:center}
      .toolbar{display:flex;gap:8px;margin-bottom:14px}
      .toolbar button{padding:6px 16px;font-size:13px;font-family:inherit;border:1px solid #cbd5e1;border-radius:6px;background:#f1f5f9;color:#334155;cursor:pointer}
      .toolbar button.primary{background:#8b5e34;border-color:#8b5e34;color:#fff}
      /* Page setup: print only the report (hide the toolbar), landscape. */
      @page{size:landscape;margin:10mm}
      @media print{.toolbar{display:none} body{margin:0}}
    </style></head><body>
    <div class="toolbar">
      <button class="primary" onclick="window.print()">Print</button>
      <button onclick="window.close()">Close</button>
    </div>
    <h1>${esc(spec.companyName)}</h1>
    <p class="sub">${esc(spec.subtitle)}</p>
    <p class="date">${new Date().toLocaleString()}</p>
    ${body || '<p>No records match the current filters.</p>'}
    </body></html>`;
  const w = window.open('', '_blank', 'width=1100,height=800');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  w.focus();
  return true;
}

export function pdfReport(spec: ReportSpec): void {
  const { columns, weights } = spec;
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
  const columnStyles = Object.fromEntries(
    columns.map((_, i) => [
      i,
      { cellWidth: (weights[i] / totalW) * tableWidth },
    ]),
  );

  for (const b of spec.blocks) {
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
        head: [columns as unknown as string[]],
        body: t.rows.map((r) => r.map(fmt)),
        styles: { fontSize: 8, cellPadding: 1.5, overflow: 'linebreak' },
        headStyles: { fillColor: [120, 98, 72], halign: 'center' },
        columnStyles,
        margin: { left: 16, right: 14 },
        theme: 'grid',
        tableWidth,
      });
      y =
        (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
          .finalY + 6;
    }
    if (b.heading) y += 1;
  }
  doc.save(`${spec.fileBase}-${reportStamp()}.pdf`);
}

/**
 * Flat worksheet. Optional `headingLabel`/`subheadingLabel` prepend the block
 * heading / table sub-heading as leading columns (e.g. Category, Group) so the
 * grouping is preserved in a spreadsheet-friendly flat form.
 */
export function excelReport(
  spec: ReportSpec,
  grouping?: { headingLabel?: string; subheadingLabel?: string },
): void {
  const { headingLabel, subheadingLabel } = grouping ?? {};
  const header = [
    ...(headingLabel ? [headingLabel] : []),
    ...(subheadingLabel ? [subheadingLabel] : []),
    ...spec.columns,
  ];
  const rows: Cell[][] = [];
  for (const b of spec.blocks)
    for (const t of b.tables)
      for (const r of t.rows)
        rows.push([
          ...(headingLabel ? [b.heading ?? ''] : []),
          ...(subheadingLabel ? [t.subheading ?? ''] : []),
          ...r,
        ]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, `${spec.fileBase}-${reportStamp()}.xlsx`);
}
