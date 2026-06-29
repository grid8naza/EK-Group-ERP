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
const WEIGHTS = [10, 22, 42, 14, 12];
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

  // Groups grouped by category (sorted by name), groups sorted by name.
  const blocks = useMemo<ReportBlock[]>(() => {
    let rows = data ?? [];
    if (categoryFilter)
      rows = rows.filter((g) => String(g.categoryId) === categoryFilter);
    if (applies === 'item') rows = rows.filter((g) => g.forItem);
    else if (applies === 'product') rows = rows.filter((g) => g.forProduct);

    const byCat = new Map<string, Group[]>();
    for (const g of rows) {
      const cat = g.category?.name ?? UNCATEGORISED;
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(g);
    }
    return [...byCat.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([categoryName, list]) => ({
        heading: categoryName,
        count: list.length,
        tables: [
          {
            rows: [...list]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((g) => [
                g.code,
                g.name,
                g.description ?? '-',
                appliesTo(g.forItem, g.forProduct),
                g.isActive ? 'Active' : 'Inactive',
              ]),
          },
        ],
      }));
  }, [data, categoryFilter, applies]);

  const total = blocks.reduce((n, b) => n + (b.count ?? 0), 0);
  const spec: ReportSpec = {
    companyName,
    subtitle: `Group List - ${total} ${total === 1 ? 'group' : 'groups'}`,
    columns: COLUMNS,
    weights: WEIGHTS,
    blocks,
    fileBase: 'group-report',
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
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            wrapClassName="w-48"
            placeholder="All categories"
            options={(categories ?? []).map((c) => ({
              value: String(c.id),
              label: c.name,
            }))}
          />
          <Select
            value={applies}
            onChange={(e) => setApplies(e.target.value)}
            wrapClassName="w-48"
            placeholder="Applies to: All"
            options={[
              { value: 'item', label: 'Item-wise' },
              { value: 'product', label: 'Product-wise' },
            ]}
          />
          <span className="ml-auto text-sm text-slate-500 dark:text-slate-400">
            {total} group{total === 1 ? '' : 's'}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <ReportView
            columns={COLUMNS}
            weights={WEIGHTS}
            blocks={blocks}
            loading={loading}
            statusCol={4}
            boldCol={1}
            emptyText="No groups match the current filter."
          />
        </div>
      </div>
    </div>
  );
}
