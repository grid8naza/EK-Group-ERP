'use client';

import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Field';
import { ColumnToggle } from '@/components/ui/ColumnToggle';
import {
  ReportView,
  ReportExportButtons,
  useReportColumns,
} from '@/components/ui/ReportView';
import {
  printReport,
  pdfReport,
  excelReport,
  resolveCompanyName,
  money,
  qty,
  type ReportBlock,
  type ReportColumn,
  type ReportSpec,
} from '@/lib/reportDoc';
import type { Item, Category, Group, Unit, Company } from '@/lib/types';

const ROUTE = '/inventory/reports/items';

const UNCATEGORISED = '— Uncategorised —';
const UNGROUPED = '— Ungrouped —';

export default function ItemsReportPage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();
  const { data, loading } = useFetch<Item[]>('/items');
  const { data: categories } = useFetch<Category[]>('/categories');
  const { data: groups } = useFetch<Group[]>('/groups');
  const { data: units } = useFetch<Unit[]>('/units');
  const { data: companies } = useFetch<Company[]>('/companies');

  // A stock unit's decimal places (Unit master) drives quantity precision; the
  // price is always two decimals.
  const unitDecimalsById = useMemo(() => {
    const m = new Map<number, number>();
    for (const u of units ?? []) m.set(u.id, u.decimalPlaces);
    return m;
  }, [units]);

  const allColumns = useMemo<ReportColumn<Item>[]>(
    () => [
      { key: 'code', header: 'Code', weight: 9, cell: (i) => i.code },
      {
        key: 'name',
        header: 'Item',
        weight: 26,
        bold: true,
        cell: (i) => i.name,
      },
      {
        key: 'unit',
        header: 'Unit',
        weight: 7,
        cell: (i) => i.unit?.symbol ?? i.unit?.code ?? '-',
      },
      {
        key: 'lastPrice',
        header: 'Last Price',
        weight: 11,
        numeric: true,
        cell: (i) => money(i.lastPurchasePrice ?? 0),
      },
      {
        key: 'hsn',
        header: 'HSN',
        weight: 9,
        cell: (i) => i.hsnCode?.code ?? '-',
      },
      {
        key: 'reorder',
        header: 'Reorder',
        weight: 10,
        numeric: true,
        cell: (i) =>
          qty(i.reorderLevel ?? 0, unitDecimalsById.get(i.unitId) ?? 0),
      },
      {
        key: 'leadTime',
        header: 'Lead Time',
        weight: 11,
        cell: (i) => i.leadTime ?? 0,
      },
      {
        key: 'shelfLife',
        header: 'Shelf Life',
        weight: 11,
        cell: (i) => i.shelfLife ?? 0,
      },
      {
        key: 'status',
        header: 'Status',
        weight: 10,
        status: true,
        cell: (i) => (i.isActive ? 'Active' : 'Inactive'),
      },
    ],
    [unitDecimalsById],
  );

  const { hidden, toggle, selected } = useReportColumns(ROUTE, allColumns);

  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  const [categoryFilter, setCategoryFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');

  // Group dropdown follows the selected category (all groups when none chosen).
  const filterGroups = useMemo(
    () =>
      (groups ?? []).filter(
        (g) =>
          !categoryFilter || g.categoryIds.includes(Number(categoryFilter)),
      ),
    [groups, categoryFilter],
  );

  // Build the grouped, sorted report: category (by name) → group (by name) →
  // items (by name), honouring the two filters and the visible columns.
  const blocks = useMemo<ReportBlock[]>(() => {
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

    return [...byCat.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([categoryName, groupsMap]) => {
        const tables = [...groupsMap.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([groupName, items]) => ({
            subheading: groupName,
            subcount: items.length,
            rows: [...items]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(selected.cells),
          }));
        return {
          heading: categoryName,
          count: tables.reduce((n, t) => n + t.rows.length, 0),
          tables,
        };
      });
  }, [data, categoryFilter, groupFilter, selected]);

  const total = blocks.reduce((n, b) => n + (b.count ?? 0), 0);

  // Summary reflects the filtered report: category blocks, group tables, items.
  const summary = useMemo(
    () => [
      { label: 'Total Categories', value: blocks.length },
      {
        label: 'Total Groups',
        value: blocks.reduce((n, b) => n + b.tables.length, 0),
      },
      { label: 'Total Items', value: total },
    ],
    [blocks, total],
  );

  const spec: ReportSpec = {
    companyName,
    subtitle: `Items List - ${total} ${total === 1 ? 'item' : 'items'}`,
    columns: selected.columns,
    weights: selected.weights,
    blocks,
    fileBase: 'items-report',
    serial: true,
    summary,
    numericCols: selected.numericCols,
  };

  const has = total > 0;
  const canPrint = can(ROUTE, 'print');
  const popupBlocked = () =>
    toast.error('Pop-up blocked — allow pop-ups to print.');
  const onPreview = () => {
    if (!printReport(spec, { allowPrint: canPrint })) popupBlocked();
  };
  const onPrint = () => {
    if (!printReport(spec, { autoPrint: true })) popupBlocked();
  };

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Items List Report"
        description="Items grouped by category and group, with print and export"
        icon={<BarChart3 className="h-5 w-5" />}
        actions={
          <ReportExportButtons
            canPrint={canPrint}
            canPdf={can(ROUTE, 'downloadPdf')}
            canExcel={can(ROUTE, 'downloadExcel')}
            onPreview={onPreview}
            onPrint={onPrint}
            onPdf={() => pdfReport(spec)}
            onExcel={() =>
              excelReport(spec, {
                headingLabel: 'Category',
                subheadingLabel: 'Group',
              })
            }
            disabled={!has}
          />
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Filters — group cascades from category */}
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
          <div className="ml-auto flex items-center gap-2">
            <ColumnToggle
              columns={allColumns.map((c) => ({ key: c.key, label: c.header }))}
              hidden={hidden}
              onToggle={toggle}
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {total} item{total === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <ReportView
            columns={selected.columns}
            weights={selected.weights}
            blocks={blocks}
            loading={loading}
            statusCol={selected.statusCol}
            boldCol={selected.boldCol}
            numericCols={selected.numericCols}
            serial
            summary={summary}
            emptyText="No items match the current filters."
          />
        </div>
      </div>
    </div>
  );
}
