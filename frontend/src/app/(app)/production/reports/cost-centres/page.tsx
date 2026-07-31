'use client';

import { useMemo, useState } from 'react';
import { Target } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Input } from '@/components/ui/Field';
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
  type ReportBlock,
  type ReportColumn,
  type ReportSpec,
} from '@/lib/reportDoc';
import type { Company, CostObjectPerformance } from '@/lib/types';

const ROUTE = '/production/reports/cost-centres';

const ALL_COLUMNS: ReportColumn<CostObjectPerformance>[] = [
  {
    key: 'costObject',
    header: 'Cost Object',
    weight: 20,
    bold: true,
    cell: (r) => r.costObjectName,
  },
  {
    key: 'producedQty',
    header: 'Produced Qty',
    weight: 11,
    numeric: true,
    group: 'Produced',
    subHeader: 'Qty',
    cell: (r) => money(r.producedQty),
  },
  {
    key: 'producedValue',
    header: 'Produced Value',
    weight: 12,
    numeric: true,
    group: 'Produced',
    subHeader: 'Value',
    cell: (r) => money(r.producedValue),
  },
  {
    key: 'consumedQty',
    header: 'Consumed Qty',
    weight: 11,
    numeric: true,
    group: 'Materials Consumed',
    subHeader: 'Qty',
    cell: (r) => money(r.consumedQty),
  },
  {
    key: 'consumedValue',
    header: 'Consumed Value',
    weight: 12,
    numeric: true,
    group: 'Materials Consumed',
    subHeader: 'Value',
    cell: (r) => money(r.consumedValue),
  },
  {
    key: 'soldQty',
    header: 'Sold Qty',
    weight: 11,
    numeric: true,
    group: 'Sold',
    subHeader: 'Qty',
    cell: (r) => money(r.soldQty),
  },
  {
    key: 'soldValue',
    header: 'Sold Value',
    weight: 12,
    numeric: true,
    group: 'Sold',
    subHeader: 'Value',
    cell: (r) => money(r.soldValue),
  },
  {
    key: 'documents',
    header: 'Docs',
    weight: 8,
    numeric: true,
    cell: (r) => String(r.documentCount),
  },
];

/** Today and the first of the month, as yyyy-mm-dd for the date inputs. */
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function CostCentrePerformancePage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();

  const today = new Date();
  const [from, setFrom] = useState(
    iso(new Date(today.getFullYear(), today.getMonth(), 1)),
  );
  const [to, setTo] = useState(iso(today));

  // Refetched whenever the range changes — the aggregation happens server-side
  // over the ledger, so there is nothing to filter client-side.
  const { data, loading } = useFetch<CostObjectPerformance[]>(
    `/production-performance/by-cost-object?from=${from}&to=${to}`,
    [from, to],
  );
  const { data: companies } = useFetch<Company[]>('/companies');

  const { hidden, toggle, selected } = useReportColumns(ROUTE, ALL_COLUMNS);

  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  // Cost objects sit under their cost centre, so the centre is the block
  // heading rather than a repeated column.
  const blocks = useMemo<ReportBlock[]>(() => {
    const byCentre = new Map<string, CostObjectPerformance[]>();
    for (const r of data ?? []) {
      const key = r.costCenterName;
      (byCentre.get(key) ?? byCentre.set(key, []).get(key)!).push(r);
    }
    return [...byCentre.entries()].map(([heading, rows]) => ({
      heading,
      count: rows.length,
      tables: [{ rows: rows.map(selected.cells) }],
    }));
  }, [data, selected]);

  const total = (data ?? []).length;

  const summary = useMemo(() => {
    // Summary values are numbers (the report formats them), so round rather
    // than pre-format here.
    const sum = (pick: (r: CostObjectPerformance) => number) =>
      Math.round((data ?? []).reduce((n, r) => n + pick(r), 0) * 100) / 100;
    return [
      { label: 'Cost Objects', value: total },
      { label: 'Produced Value', value: sum((r) => r.producedValue) },
      { label: 'Consumed Value', value: sum((r) => r.consumedValue) },
      { label: 'Sold Value', value: sum((r) => r.soldValue) },
    ];
  }, [data, total]);

  const spec: ReportSpec = {
    companyName,
    subtitle: `Cost Centre Performance - ${from} to ${to}`,
    columns: selected.columns,
    weights: selected.weights,
    blocks,
    fileBase: 'cost-centre-performance',
    serial: true,
    summary,
    numericCols: selected.numericCols,
    groups: selected.groups,
    subHeaders: selected.subHeaders,
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
        title="Cost Centre Performance"
        description="What each cost object produced, consumed and sold — from production's own movements"
        icon={<Target className="h-5 w-5" />}
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
          <Input
            type="date"
            label="From"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            wrapClassName="w-44"
          />
          <Input
            type="date"
            label="To"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            wrapClassName="w-44"
          />
          <div className="ml-auto flex items-center gap-2">
            <ColumnToggle
              columns={ALL_COLUMNS.map((c) => ({ key: c.key, label: c.header }))}
              hidden={hidden}
              onToggle={toggle}
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {total} cost object{total === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <ReportView
            columns={selected.columns}
            weights={selected.weights}
            blocks={blocks}
            loading={loading}
            boldCol={selected.boldCol}
            serial
            emptyText="No production movements in this period."
          />
        </div>
      </div>
    </div>
  );
}
