'use client';

import { useMemo } from 'react';
import { Tag } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { ReportView, ReportExportButtons } from '@/components/ui/ReportView';
import {
  printReport,
  pdfReport,
  excelReport,
  resolveCompanyName,
  type Cell,
  type ReportSpec,
} from '@/lib/reportDoc';
import type { AssetCategory, Company } from '@/lib/types';

const ROUTE = '/asset/reports/asset-categories';
const COLUMNS = ['Code', 'Category', 'Description', 'Availability', 'Status'] as const;
const WEIGHTS = [16, 26, 34, 12, 12];

const availability = (c: AssetCategory) =>
  c.allCompanies
    ? 'All companies'
    : `${c.companyIds.length} ${c.companyIds.length === 1 ? 'company' : 'companies'}`;

export default function AssetCategoryReportPage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();
  const { data, loading } = useFetch<AssetCategory[]>('/asset-categories');
  const { data: companies } = useFetch<Company[]>('/companies');

  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  // Categories ordered by code.
  const sorted = useMemo(
    () => [...(data ?? [])].sort((a, b) => a.code.localeCompare(b.code)),
    [data],
  );

  const rows = useMemo<Cell[][]>(
    () =>
      sorted.map((c) => [
        c.code,
        c.name,
        c.description ?? '-',
        availability(c),
        c.isActive ? 'Active' : 'Inactive',
      ]),
    [sorted],
  );

  const total = rows.length;

  const spec: ReportSpec = {
    companyName,
    subtitle: `Asset Category List - ${total} ${total === 1 ? 'category' : 'categories'}`,
    columns: COLUMNS,
    weights: WEIGHTS,
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
            emptyText="No asset categories found."
          />
        </div>
      </div>
    </div>
  );
}
