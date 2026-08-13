'use client';

import { useMemo } from 'react';
import { Tag } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
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
import type { AssetCategory, Company } from '@/lib/types';

const ROUTE = '/asset/reports/asset-categories';

const availability = (c: AssetCategory) =>
  c.allCompanies
    ? 'All companies'
    : `${c.companyIds.length} ${c.companyIds.length === 1 ? 'company' : 'companies'}`;

const ALL_COLUMNS: ReportColumn<AssetCategory>[] = [
  { key: 'code', header: 'Code', weight: 16, cell: (c) => c.code },
  {
    key: 'name',
    header: 'Category',
    weight: 26,
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
    key: 'availability',
    header: 'Availability',
    weight: 12,
    cell: availability,
  },
  {
    key: 'status',
    header: 'Status',
    weight: 12,
    status: true,
    cell: (c) => (c.isActive ? 'Active' : 'Inactive'),
  },
];

export default function AssetCategoryReportPage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();
  const { data, loading } = useFetch<AssetCategory[]>('/asset-categories');
  const { data: companies } = useFetch<Company[]>('/companies');

  const { hidden, toggle, selected } = useReportColumns(ROUTE, ALL_COLUMNS);

  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  // Categories ordered by code, cells built from the visible columns.
  const rows = useMemo(
    () =>
      [...(data ?? [])]
        .sort((a, b) => a.code.localeCompare(b.code))
        .map(selected.cells),
    [data, selected],
  );

  const total = rows.length;

  const spec: ReportSpec = {
    companyName,
    subtitle: `Asset Category List - ${total} ${total === 1 ? 'category' : 'categories'}`,
    columns: selected.columns,
    weights: selected.weights,
    blocks: [{ tables: [{ rows }] }],
    fileBase: 'asset-category-report',
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
        title="Asset Category Report"
        description="All asset categories with description, availability and status"
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
            emptyText="No asset categories found."
          />
        </div>
      </div>
    </div>
  );
}
