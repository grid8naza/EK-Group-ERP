'use client';

import { useMemo, useState } from 'react';
import { Tag } from 'lucide-react';
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
  type ReportSpec,
} from '@/lib/reportDoc';
import type { Category, Company } from '@/lib/types';

const ROUTE = '/inventory/reports/categories';
const COLUMNS = ['Code', 'Category', 'Description', 'Applies To', 'Status'] as const;
const WEIGHTS = [16, 24, 34, 14, 12];

const appliesTo = (forItem: boolean, forProduct: boolean) =>
  [forItem ? 'Item' : null, forProduct ? 'Product' : null]
    .filter(Boolean)
    .join(', ') || '-';

export default function CategoryReportPage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();
  const { data, loading } = useFetch<Category[]>('/categories');
  const { data: companies } = useFetch<Company[]>('/companies');

  const [applies, setApplies] = useState(''); // '' | 'item' | 'product'

  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  // Categories after the applicability filter, ordered by code.
  const filteredCats = useMemo(() => {
    let cats = data ?? [];
    if (applies === 'item') cats = cats.filter((c) => c.forItem);
    else if (applies === 'product') cats = cats.filter((c) => c.forProduct);
    return [...cats].sort((a, b) => a.code.localeCompare(b.code));
  }, [data, applies]);

  const rows = useMemo<Cell[][]>(
    () =>
      filteredCats.map((c) => [
        c.code,
        c.name,
        c.description ?? '-',
        appliesTo(c.forItem, c.forProduct),
        c.isActive ? 'Active' : 'Inactive',
      ]),
    [filteredCats],
  );

  const total = rows.length;

  const spec: ReportSpec = {
    companyName,
    subtitle: `Category List - ${total} ${total === 1 ? 'category' : 'categories'}`,
    columns: COLUMNS,
    weights: WEIGHTS,
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
          <span className="ml-auto text-sm text-slate-500 dark:text-slate-400">
            {total} categor{total === 1 ? 'y' : 'ies'}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <ReportView
            columns={COLUMNS}
            weights={WEIGHTS}
            blocks={spec.blocks}
            loading={loading}
            statusCol={4}
            boldCol={1}
            serial
            emptyText="No categories found."
          />
        </div>
      </div>
    </div>
  );
}
