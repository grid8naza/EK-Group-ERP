'use client';

import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Field';
import { ReportView, ReportExportButtons } from '@/components/ui/ReportView';
import {
  printReport,
  pdfReport,
  excelReport,
  resolveCompanyName,
  type Cell,
  type ReportBlock,
  type ReportSpec,
} from '@/lib/reportDoc';
import type { Item, Category, Group, Company } from '@/lib/types';

const ROUTE = '/inventory/reports/items';

// Report columns (the "standard set"). Item gets the most room; the rest are
// fixed and equal across all groups so every table lines up.
const COLUMNS = [
  'Code',
  'Item',
  'Unit',
  'Unit Price',
  'HSN',
  'Reorder',
  'Lead Time',
  'Shelf Life',
  'Status',
] as const;
const WEIGHTS = [9, 26, 7, 11, 9, 10, 11, 11, 10];

const UNCATEGORISED = '— Uncategorised —';
const UNGROUPED = '— Ungrouped —';

const itemCells = (i: Item): Cell[] => [
  i.code,
  i.name,
  i.unit?.code ?? '-',
  i.unitPrice ?? 0,
  i.hsnCode?.code ?? '-',
  i.reorderLevel ?? 0,
  i.leadTime ?? 0,
  i.shelfLife ?? 0,
  i.isActive ? 'Active' : 'Inactive',
];

export default function ItemsReportPage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();
  const { data, loading } = useFetch<Item[]>('/items');
  const { data: categories } = useFetch<Category[]>('/categories');
  const { data: groups } = useFetch<Group[]>('/groups');
  const { data: companies } = useFetch<Company[]>('/companies');

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
        (g) => !categoryFilter || String(g.categoryId) === categoryFilter,
      ),
    [groups, categoryFilter],
  );

  // Build the grouped, sorted report: category (by name) → group (by name) →
  // items (by name), honouring the two filters.
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
              .map(itemCells),
          }));
        return {
          heading: categoryName,
          count: tables.reduce((n, t) => n + t.rows.length, 0),
          tables,
        };
      });
  }, [data, categoryFilter, groupFilter]);

  const total = blocks.reduce((n, b) => n + (b.count ?? 0), 0);
  const spec: ReportSpec = {
    companyName,
    subtitle: `Items List - ${total} ${total === 1 ? 'item' : 'items'}`,
    columns: COLUMNS,
    weights: WEIGHTS,
    blocks,
    fileBase: 'items-report',
  };

  const has = total > 0;
  const onPrint = () => {
    if (!printReport(spec))
      toast.error('Pop-up blocked — allow pop-ups to print.');
  };

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Items List Report"
        description="Items grouped by category and group, with print and export"
        icon={<BarChart3 className="h-5 w-5" />}
        actions={
          <ReportExportButtons
            canPrint={can(ROUTE, 'print')}
            canPdf={can(ROUTE, 'downloadPdf')}
            canExcel={can(ROUTE, 'downloadExcel')}
            onPrint={onPrint}
            onPdf={() => pdfReport(spec)}
            onExcel={() =>
              excelReport(spec, { headingLabel: 'Category', subheadingLabel: 'Group' })
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
          <span className="ml-auto text-sm text-slate-500 dark:text-slate-400">
            {total} item{total === 1 ? '' : 's'}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <ReportView
            columns={COLUMNS}
            weights={WEIGHTS}
            blocks={blocks}
            loading={loading}
            statusCol={8}
            boldCol={1}
            emptyText="No items match the current filters."
          />
        </div>
      </div>
    </div>
  );
}
