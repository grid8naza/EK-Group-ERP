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
import type { AssetGroup, AssetCategory, Company } from '@/lib/types';

const ROUTE = '/asset/reports/asset-groups';
const UNCATEGORISED = '— Uncategorised —';

const ALL_COLUMNS: ReportColumn<AssetGroup>[] = [
  { key: 'code', header: 'Code', weight: 18, cell: (g) => g.code },
  { key: 'name', header: 'Group', weight: 28, bold: true, cell: (g) => g.name },
  {
    key: 'description',
    header: 'Description',
    weight: 42,
    cell: (g) => g.description ?? '-',
  },
  {
    key: 'status',
    header: 'Status',
    weight: 12,
    status: true,
    cell: (g) => (g.isActive ? 'Active' : 'Inactive'),
  },
];

export default function AssetGroupReportPage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();
  const { data, loading } = useFetch<AssetGroup[]>('/asset-groups');
  const { data: categories } = useFetch<AssetCategory[]>('/asset-categories');
  const { data: companies } = useFetch<Company[]>('/companies');

  const { hidden, toggle, selected } = useReportColumns(ROUTE, ALL_COLUMNS);
  const [categoryFilter, setCategoryFilter] = useState('');

  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  // Groups after the category filter — shared by the report and summary.
  const filteredGroups = useMemo(() => {
    let rows = data ?? [];
    if (categoryFilter)
      rows = rows.filter((g) => String(g.categoryId) === categoryFilter);
    return rows;
  }, [data, categoryFilter]);

  // Groups grouped by category (sorted by name); groups sorted by code so
  // sub-groups sit under their parent (the positional code encodes hierarchy).
  const blocks = useMemo<ReportBlock[]>(() => {
    const byCat = new Map<string, AssetGroup[]>();
    for (const g of filteredGroups) {
      const cat = g.category?.name ?? UNCATEGORISED;
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(g);
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
    subtitle: `Asset Group List - ${total} ${total === 1 ? 'group' : 'groups'}`,
    columns: selected.columns,
    weights: selected.weights,
    blocks,
    fileBase: 'asset-group-report',
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
        title="Asset Group Report"
        description="Asset groups grouped by category, with print and export"
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
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            wrapClassName="w-48"
            placeholder="All categories"
            options={(categories ?? []).map((c) => ({
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
            emptyText="No asset groups match the current filter."
          />
        </div>
      </div>
    </div>
  );
}
