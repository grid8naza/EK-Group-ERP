'use client';

import { useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
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
  type ReportBlock,
  type ReportSpec,
} from '@/lib/reportDoc';
import type { Group, Category, Company } from '@/lib/types';

const ROUTE = '/inventory/reports/groups';
const COLUMNS = ['Code', 'Group', 'Description', 'Applies To', 'Status'] as const;
const WEIGHTS = [16, 24, 34, 14, 12];
const UNCATEGORISED = '— Uncategorised —';

const appliesTo = (forItem: boolean, forProduct: boolean) =>
  [forItem ? 'Item' : null, forProduct ? 'Product' : null]
    .filter(Boolean)
    .join(', ') || '-';

export default function GroupReportPage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();
  const { data, loading } = useFetch<Group[]>('/groups');
  const { data: categories } = useFetch<Category[]>('/categories');
  const { data: companies } = useFetch<Company[]>('/companies');

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
    if (applies === 'item') cats = cats.filter((c) => c.forItem);
    else if (applies === 'product') cats = cats.filter((c) => c.forProduct);
    return cats;
  }, [categories, applies]);

  // Groups after applying the two filters — shared by the report and summary.
  const filteredGroups = useMemo(() => {
    let rows = data ?? [];
    if (categoryFilter)
      rows = rows.filter((g) => String(g.categoryId) === categoryFilter);
    if (applies === 'item') rows = rows.filter((g) => g.forItem);
    else if (applies === 'product') rows = rows.filter((g) => g.forProduct);
    return rows;
  }, [data, categoryFilter, applies]);

  // Groups grouped by category (sorted by name), groups sorted by name.
  const blocks = useMemo<ReportBlock[]>(() => {
    const rows = filteredGroups;
    const byCat = new Map<string, Group[]>();
    for (const g of rows) {
      const cat = g.category?.name ?? UNCATEGORISED;
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(g);
    }
    return [...byCat.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([categoryName, list]) => {
        // Sort by code, not name, so sub-groups sit under their parent group
        // (the 15-digit positional code encodes the hierarchy).
        const sorted = [...list].sort((a, b) => a.code.localeCompare(b.code));
        return {
          heading: categoryName,
          count: list.length,
          tables: [
            {
              rows: sorted.map((g) => [
                g.code,
                g.name,
                g.description ?? '-',
                appliesTo(g.forItem, g.forProduct),
                g.isActive ? 'Active' : 'Inactive',
              ]),
              // Primary (level-1) groups get a light highlight.
              shade: sorted.map((g) => g.level === 1),
            },
          ],
        };
      });
  }, [filteredGroups]);

  const total = blocks.reduce((n, b) => n + (b.count ?? 0), 0);

  // Summary reflects the filtered report: categories shown, then a per-level
  // group count (Group - L1, Group - L2, …). No item total — this is a groups
  // report.
  const summary = useMemo(() => {
    const byLevel = new Map<number, number>();
    for (const g of filteredGroups)
      byLevel.set(g.level, (byLevel.get(g.level) ?? 0) + 1);
    const levels = [...byLevel.keys()].sort((a, b) => a - b);
    return [
      { label: 'Total Categories', value: blocks.length },
      ...levels.map((l) => ({
        label: `Group - L${l}`,
        value: byLevel.get(l)!,
      })),
    ];
  }, [filteredGroups, blocks.length]);

  const spec: ReportSpec = {
    companyName,
    subtitle: `Group List - ${total} ${total === 1 ? 'group' : 'groups'}`,
    columns: COLUMNS,
    weights: WEIGHTS,
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
          <span className="ml-auto text-sm text-slate-500 dark:text-slate-400">
            {total} group{total === 1 ? '' : 's'}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <ReportView
            columns={COLUMNS}
            weights={WEIGHTS}
            blocks={blocks}
            loading={loading}
            statusCol={4}
            boldCol={1}
            serial
            summary={summary}
            emptyText="No groups match the current filter."
          />
        </div>
      </div>
    </div>
  );
}
