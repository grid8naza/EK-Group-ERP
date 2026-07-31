'use client';

import { useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
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
  type ReportBlock,
  type ReportColumn,
  type ReportSpec,
} from '@/lib/reportDoc';
import { ITEM_KINDS, PRODUCT_KINDS } from '@/lib/types';
import type { Group, Category, Company } from '@/lib/types';

const ROUTE = '/inventory/reports/groups';
const UNCATEGORISED = '— Uncategorised —';

const appliesTo = (forItem: boolean, forProduct: boolean) =>
  [forItem ? 'Item' : null, forProduct ? 'Product' : null]
    .filter(Boolean)
    .join(', ') || '-';

const ALL_COLUMNS: ReportColumn<Group>[] = [
  { key: 'code', header: 'Code', weight: 16, cell: (g) => g.code },
  { key: 'name', header: 'Group', weight: 24, bold: true, cell: (g) => g.name },
  {
    key: 'description',
    header: 'Description',
    weight: 34,
    cell: (g) => g.description ?? '-',
  },
  {
    key: 'applies',
    header: 'Applies To',
    weight: 14,
    cell: (g) => appliesTo(g.forItem, g.forProduct),
  },
  {
    key: 'status',
    header: 'Status',
    weight: 12,
    status: true,
    cell: (g) => (g.isActive ? 'Active' : 'Inactive'),
  },
];

export default function GroupReportPage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();
  const { data, loading } = useFetch<Group[]>('/groups');
  const { data: categories } = useFetch<Category[]>('/categories');
  const { data: companies } = useFetch<Company[]>('/companies');

  const { hidden, toggle, selected } = useReportColumns(ROUTE, ALL_COLUMNS);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [applies, setApplies] = useState(''); // '' | 'item' | 'product'

  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  // Category dropdown cascades from the selected "Applies To": Item-wise lists
  // only item categories, Product-wise only product categories.
  const filterCategories = useMemo(() => {
    let cats = categories ?? [];
    if (applies === 'item') cats = cats.filter((c) => ITEM_KINDS.includes(c.kind));
    else if (applies === 'product')
      cats = cats.filter((c) => PRODUCT_KINDS.includes(c.kind));
    return cats;
  }, [categories, applies]);

  // Groups after applying the two filters — shared by the report and summary.
  const filteredGroups = useMemo(() => {
    let rows = data ?? [];
    if (categoryFilter)
      rows = rows.filter((g) => g.categoryIds.includes(Number(categoryFilter)));
    if (applies === 'item') rows = rows.filter((g) => g.forItem);
    else if (applies === 'product') rows = rows.filter((g) => g.forProduct);
    return rows;
  }, [data, categoryFilter, applies]);

  // Groups listed under each category they serve (sorted by name); groups
  // sorted by code so sub-groups sit under their parent (the positional code
  // encodes it). A shared group appears under every one of its categories —
  // that is the point of the report, so the per-block counts overlap.
  const blocks = useMemo<ReportBlock[]>(() => {
    const byCat = new Map<string, Group[]>();
    for (const g of filteredGroups) {
      const names = g.categories?.length
        ? g.categories.map((c) => c.name)
        : [UNCATEGORISED];
      for (const cat of names) {
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat)!.push(g);
      }
    }
    return [...byCat.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([categoryName, list]) => {
        const sorted = [...list].sort((a, b) => a.code.localeCompare(b.code));
        return {
          heading: categoryName,
          count: list.length,
          tables: [
            {
              rows: sorted.map(selected.cells),
              // Primary (level-1) groups get a light highlight.
              shade: sorted.map((g) => g.level === 1),
            },
          ],
        };
      });
  }, [filteredGroups, selected]);

  const total = blocks.reduce((n, b) => n + (b.count ?? 0), 0);

  // Summary reflects the filtered report: categories shown, then a per-level
  // group count (Group - L1, Group - L2, …).
  const summary = useMemo(() => {
    const byLevel = new Map<number, number>();
    for (const g of filteredGroups)
      byLevel.set(g.level, (byLevel.get(g.level) ?? 0) + 1);
    const levels = [...byLevel.keys()].sort((a, b) => a - b);
    return [
      { label: 'Total Categories', value: blocks.length },
      ...levels.map((l) => ({ label: `Group - L${l}`, value: byLevel.get(l)! })),
    ];
  }, [filteredGroups, blocks.length]);

  const spec: ReportSpec = {
    companyName,
    subtitle: `Group List - ${total} ${total === 1 ? 'group' : 'groups'}`,
    columns: selected.columns,
    weights: selected.weights,
    blocks,
    fileBase: 'group-report',
    serial: true,
    summary,
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
        title="Group Report"
        description="Groups grouped by category, with print and export"
        icon={<Layers className="h-5 w-5" />}
        actions={
          <ReportExportButtons
            canPrint={canPrint}
            canPdf={can(ROUTE, 'downloadPdf')}
            canExcel={can(ROUTE, 'downloadExcel')}
            onPreview={onPreview}
            onPrint={onPrint}
            onPdf={() => pdfReport(spec)}
            onExcel={() => excelReport(spec, { headingLabel: 'Category' })}
            disabled={!has}
          />
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <Select
            value={applies}
            onChange={(e) => {
              setApplies(e.target.value);
              setCategoryFilter(''); // reset category when applicability changes
            }}
            wrapClassName="w-48"
            placeholder="Applies to: All"
            options={[
              { value: 'item', label: 'Item-wise' },
              { value: 'product', label: 'Product-wise' },
            ]}
          />
          <Select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            wrapClassName="w-48"
            placeholder="All categories"
            options={filterCategories.map((c) => ({
              value: String(c.id),
              label: c.name,
            }))}
          />
          <div className="ml-auto flex items-center gap-2">
            <ColumnToggle
              columns={ALL_COLUMNS.map((c) => ({ key: c.key, label: c.header }))}
              hidden={hidden}
              onToggle={toggle}
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {total} group{total === 1 ? '' : 's'}
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
            serial
            summary={summary}
            emptyText="No groups match the current filter."
          />
        </div>
      </div>
    </div>
  );
}
