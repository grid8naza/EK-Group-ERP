'use client';

import { useMemo, useState } from 'react';
import { BarChart3, FileText, Printer, Sheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useFetch } from '@/lib/hooks';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import type { Item, Category, Group } from '@/lib/types';

const ROUTE = '/inventory/reports/items';

// Report columns (the "standard set"), shared by the on-screen table and exports.
const COLUMNS = [
  'Code',
  'Item',
  'Unit',
  'Unit Price',
  'HSN',
  'Reorder',
  'Shelf Life',
  'Status',
] as const;

const UNCATEGORISED = '— Uncategorised —';
const UNGROUPED = '— Ungrouped —';

type GroupBlock = { groupName: string; items: Item[] };
type CategoryBlock = { categoryName: string; groups: GroupBlock[]; count: number };

const num = (n: number | null | undefined) => (n ?? 0).toLocaleString();
const itemCells = (i: Item): (string | number)[] => [
  i.code,
  i.name,
  i.unit?.code ?? '-',
  num(i.unitPrice),
  i.hsnCode?.code ?? '-',
  num(i.reorderLevel),
  num(i.shelfLife),
  i.isActive ? 'Active' : 'Inactive',
];
const stamp = () => new Date().toISOString().slice(0, 10);

export default function ItemsReportPage() {
  const { can, activeCompany } = useAuth();
  const toast = useToast();
  const { data, loading } = useFetch<Item[]>('/items');
  const { data: categories } = useFetch<Category[]>('/categories');
  const { data: groups } = useFetch<Group[]>('/groups');

  const [categoryFilter, setCategoryFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');

  const canPrint = can(ROUTE, 'print');
  const canPdf = can(ROUTE, 'downloadPdf');
  const canExcel = can(ROUTE, 'downloadExcel');

  // Group dropdown follows the selected category (all groups when none chosen).
  const filterGroups = useMemo(
    () =>
      (groups ?? []).filter(
        (g) => !categoryFilter || String(g.categoryId) === categoryFilter,
      ),
    [groups, categoryFilter],
  );

  // Build the grouped, sorted report: category (by name) → group (by name) →
  // items (by name), honouring the two filters.
  const report = useMemo(() => {
    let rows = data ?? [];
    if (categoryFilter)
      rows = rows.filter((r) => String(r.categoryId) === categoryFilter);
    if (groupFilter)
      rows = rows.filter((r) => String(r.groupId) === groupFilter);

    const byCat = new Map<string, Map<string, Item[]>>();
    for (const it of rows) {
      const cat = it.category?.name ?? UNCATEGORISED;
      const grp = it.group?.name ?? UNGROUPED;
      if (!byCat.has(cat)) byCat.set(cat, new Map());
      const g = byCat.get(cat)!;
      if (!g.has(grp)) g.set(grp, []);
      g.get(grp)!.push(it);
    }

    const cats: CategoryBlock[] = [...byCat.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([categoryName, groupsMap]) => {
        const blocks: GroupBlock[] = [...groupsMap.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([groupName, items]) => ({
            groupName,
            items: [...items].sort((a, b) => a.name.localeCompare(b.name)),
          }));
        return {
          categoryName,
          groups: blocks,
          count: blocks.reduce((n, b) => n + b.items.length, 0),
        };
      });

    return { cats, total: cats.reduce((n, c) => n + c.count, 0) };
  }, [data, categoryFilter, groupFilter]);

  // ---- exports (built from the grouped data, so they honour the filters) ----

  const exportExcel = () => {
    const rows = report.cats.flatMap((c) =>
      c.groups.flatMap((g) =>
        g.items.map((it) => ({
          Category: c.categoryName,
          Group: g.groupName,
          Code: it.code,
          Item: it.name,
          Unit: it.unit?.code ?? '',
          'Unit Price': it.unitPrice ?? 0,
          HSN: it.hsnCode?.code ?? '',
          Reorder: it.reorderLevel ?? 0,
          'Shelf Life': it.shelfLife ?? 0,
          Status: it.isActive ? 'Active' : 'Inactive',
        })),
      ),
    );
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Items');
    XLSX.writeFile(wb, `items-report-${stamp()}.xlsx`);
  };

  const exportPdf = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Items List Report', 14, 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(
      `${activeCompany?.name ?? ''}    ${new Date().toLocaleString()}    Total items: ${report.total}`,
      14,
      20,
    );

    let y = 27;
    const ensure = (needed: number) => {
      if (y + needed > pageH - 12) {
        doc.addPage();
        y = 16;
      }
    };

    for (const c of report.cats) {
      ensure(12);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(`${c.categoryName}  (${c.count})`, 14, y);
      y += 5;
      for (const g of c.groups) {
        ensure(10);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text(`${g.groupName}  (${g.items.length})`, 16, y);
        y += 2;
        autoTable(doc, {
          startY: y,
          head: [COLUMNS as unknown as string[]],
          body: g.items.map(itemCells),
          styles: { fontSize: 8, cellPadding: 1.5 },
          headStyles: { fillColor: [120, 98, 72] },
          margin: { left: 16, right: 14 },
          theme: 'grid',
          tableWidth: pageW - 30,
        });
        y = (doc as unknown as { lastAutoTable: { finalY: number } })
          .lastAutoTable.finalY + 6;
      }
      y += 1;
    }
    doc.save(`items-report-${stamp()}.pdf`);
  };

  const exportPrint = () => {
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const tableFor = (g: GroupBlock) => `
      <table>
        <thead><tr>${COLUMNS.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>${g.items
          .map(
            (it) =>
              `<tr>${itemCells(it)
                .map((v) => `<td>${esc(String(v))}</td>`)
                .join('')}</tr>`,
          )
          .join('')}</tbody>
      </table>`;
    const body = report.cats
      .map(
        (c) => `
        <h2>${esc(c.categoryName)} <span class="muted">(${c.count})</span></h2>
        ${c.groups
          .map(
            (g) =>
              `<h3>${esc(g.groupName)} <span class="muted">(${g.items.length})</span></h3>${tableFor(g)}`,
          )
          .join('')}`,
      )
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Items List Report</title>
      <style>
        *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;margin:24px}
        h1{font-size:18px;margin:0 0 2px} .sub{color:#64748b;font-size:12px;margin:0 0 16px}
        h2{font-size:14px;margin:18px 0 4px;border-bottom:2px solid #c9b896;padding-bottom:2px}
        h3{font-size:12px;margin:10px 0 4px;color:#475569}
        .muted{color:#94a3b8;font-weight:normal}
        table{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:11px}
        th,td{border:1px solid #d8d2c6;padding:4px 6px;text-align:left}
        th{background:#f3ece0}
        @media print{body{margin:10px} button{display:none}}
      </style></head><body>
      <h1>Items List Report</h1>
      <p class="sub">${esc(activeCompany?.name ?? '')} &nbsp;·&nbsp; ${new Date().toLocaleString()} &nbsp;·&nbsp; Total items: ${report.total}</p>
      ${body || '<p>No items match the current filters.</p>'}
      </body></html>`;
    const w = window.open('', '_blank', 'width=1100,height=800');
    if (!w) {
      toast.error('Pop-up blocked — allow pop-ups to print.');
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  const hasRows = report.total > 0;

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Items List Report"
        description="Items grouped by category and group, with print and export"
        icon={<BarChart3 className="h-5 w-5" />}
        actions={
          <>
            {canPrint && (
              <button
                className="btn-secondary"
                onClick={exportPrint}
                disabled={!hasRows}
              >
                <Printer className="h-4 w-4" /> Print
              </button>
            )}
            {canPdf && (
              <button
                className="btn-secondary"
                onClick={exportPdf}
                disabled={!hasRows}
              >
                <FileText className="h-4 w-4" /> PDF
              </button>
            )}
            {canExcel && (
              <button
                className="btn-primary"
                onClick={exportExcel}
                disabled={!hasRows}
              >
                <Sheet className="h-4 w-4" /> Excel
              </button>
            )}
          </>
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <Select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setGroupFilter(''); // reset group when category changes
            }}
            wrapClassName="w-48"
            placeholder="All categories"
            options={(categories ?? []).map((c) => ({
              value: String(c.id),
              label: c.name,
            }))}
          />
          <Select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            wrapClassName="w-48"
            placeholder="All groups"
            options={filterGroups.map((g) => ({
              value: String(g.id),
              label: g.name,
            }))}
          />
          <span className="ml-auto text-sm text-slate-500 dark:text-slate-400">
            {report.total} item{report.total === 1 ? '' : 's'}
          </span>
        </div>

        {/* Grouped report */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="py-12 text-center text-slate-400">Loading…</p>
          ) : !hasRows ? (
            <p className="py-12 text-center text-slate-400">
              No items match the current filters.
            </p>
          ) : (
            report.cats.map((c) => (
              <div key={c.categoryName} className="mb-6">
                <h2 className="mb-2 flex items-center gap-2 border-b-2 border-[#c9b896] pb-1 text-base font-bold text-slate-800 dark:border-slate-700 dark:text-slate-100">
                  {c.categoryName}
                  <Badge color="slate">{c.count}</Badge>
                </h2>
                {c.groups.map((g) => (
                  <div key={g.groupName} className="mb-4">
                    <h3 className="mb-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
                      {g.groupName}{' '}
                      <span className="text-slate-400">({g.items.length})</span>
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-[#efe7db] bg-[#fcfbf8] text-xs font-semibold uppercase tracking-wide text-[#6d6258] dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                            {COLUMNS.map((col) => (
                              <th key={col} className="px-3 py-2">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {g.items.map((it) => (
                            <tr
                              key={it.id}
                              className="border-b border-slate-100 last:border-0 dark:border-slate-800/60"
                            >
                              <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                                {it.code}
                              </td>
                              <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-100">
                                {it.name}
                              </td>
                              <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                                {it.unit?.code ?? '-'}
                              </td>
                              <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                                {num(it.unitPrice)}
                              </td>
                              <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                                {it.hsnCode?.code ?? '-'}
                              </td>
                              <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                                {num(it.reorderLevel)}
                              </td>
                              <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                                {num(it.shelfLife)}
                              </td>
                              <td className="px-3 py-2">
                                <Badge color={it.isActive ? 'green' : 'slate'}>
                                  {it.isActive ? 'Active' : 'Inactive'}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
