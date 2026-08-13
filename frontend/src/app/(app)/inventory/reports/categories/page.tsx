'use client';

import { useMemo, useState } from 'react';
import { Tag } from 'lucide-react';
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
  type ReportColumn,
  type ReportSpec,
} from '@/lib/reportDoc';
import { CATEGORY_KIND_LABEL, ITEM_KINDS, PRODUCT_KINDS } from '@/lib/types';
import type { Category, Company } from '@/lib/types';

const ROUTE = '/inventory/reports/categories';

const appliesTo = (c: Category) => CATEGORY_KIND_LABEL[c.kind] ?? '-';

const ALL_COLUMNS: ReportColumn<Category>[] = [
  { key: 'code', header: 'Code', weight: 16, cell: (c) => c.code },
  {
    key: 'name',
    header: 'Category',
    weight: 24,
    bold: true,
    cell: (c) => c.name,
  },
  {
    key: 'description',
    header: 'Description',
    weight: 34,
    cell: (c) => c.description ?? '-',
  },
  {
    key: 'applies',
    header: 'Applies To',
    weight: 14,
    cell: (c) => appliesTo(c),
  },
  {
    key: 'status',
    header: 'Status',
    weight: 12,
    status: true,
    cell: (c) => (c.isActive ? 'Active' : 'Inactive'),
  },
];

export default function CategoryReportPage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();
  const { data, loading } = useFetch<Category[]>('/categories');
  const { data: companies } = useFetch<Company[]>('/companies');

  const { hidden, toggle, selected } = useReportColumns(ROUTE, ALL_COLUMNS);
  const [applies, setApplies] = useState(''); // '' | 'item' | 'product'

  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  // Categories after the applicability filter, ordered by code, cells built
  // from the visible columns.
  const rows = useMemo(() => {
    let cats = data ?? [];
    if (applies === 'item')
      cats = cats.filter((c) => ITEM_KINDS.includes(c.kind));
    else if (applies === 'product')
      cats = cats.filter((c) => PRODUCT_KINDS.includes(c.kind));
    return [...cats]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(selected.cells);
  }, [data, applies, selected]);

  const total = rows.length;

  const spec: ReportSpec = {
    companyName,
    subtitle: `Category List - ${total} ${total === 1 ? 'category' : 'categories'}`,
    columns: selected.columns,
    weights: selected.weights,
    blocks: [{ tables: [{ rows }] }],
    fileBase: 'category-report',
    serial: true,
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
        title="Category Report"
        description="All categories with description, applicability and status"
        icon={<Tag className="h-5 w-5" />}
        actions={
          <ReportExportButtons
            canPrint={canPrint}
            canPdf={can(ROUTE, 'downloadPdf')}
            canExcel={can(ROUTE, 'downloadExcel')}
            onPreview={onPreview}
            onPrint={onPrint}
            onPdf={() => pdfReport(spec)}
            onExcel={() => excelReport(spec)}
            disabled={!has}
          />
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
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
          <div className="ml-auto flex items-center gap-2">
            <ColumnToggle
              columns={ALL_COLUMNS.map((c) => ({
                key: c.key,
                label: c.header,
              }))}
              hidden={hidden}
              onToggle={toggle}
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {total} categor{total === 1 ? 'y' : 'ies'}
            </span>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <ReportView
            columns={selected.columns}
            weights={selected.weights}
            blocks={spec.blocks}
            loading={loading}
            statusCol={selected.statusCol}
            boldCol={selected.boldCol}
            serial
            emptyText="No categories found."
          />
        </div>
      </div>
    </div>
  );
}
