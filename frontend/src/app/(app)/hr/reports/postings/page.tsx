'use client';

import { useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { formatDayMonthYear } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select, DateInput } from '@/components/ui/Field';
import {
  ReportView,
  ReportExportButtons,
} from '@/components/ui/ReportView';
import {
  printReport,
  pdfReport,
  excelReport,
  resolveCompanyName,
  type ReportBlock,
  type ReportSpec,
} from '@/lib/reportDoc';
import type { Company } from '@/lib/types';

const ROUTE = '/hr/reports/postings';

/** One row of the register, as the server shapes it. */
interface RegisterRow {
  id: number;
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  companyName: string | null;
  branchName: string | null;
  divisionName: string | null;
  departmentName: string | null;
  designationName: string;
  remarks: string | null;
  changes: string[];
  startedInPeriod: boolean;
}

const COLUMNS = [
  'Emp. ID',
  'Employee',
  'From',
  'To',
  'Designation',
  'Branch',
  'Division',
  'Department',
  'Event',
] as const;
const WEIGHTS = [9, 15, 9, 9, 14, 12, 12, 12, 10] as const;
/** From, To and Event. */
const CENTER_COLS = [2, 3, 8];

/** The words a person uses for what the derived change set says happened. */
const eventOf = (r: RegisterRow) => {
  if (!r.changes.length) return r.startedInPeriod ? 'Joined' : '—';
  const promoted = r.changes.includes('DESIGNATION');
  const moved = r.changes.some((c) => c !== 'DESIGNATION');
  if (promoted && moved) return 'Promotion + Transfer';
  return promoted ? 'Promotion' : 'Transfer';
};

const thisYear = new Date().getUTCFullYear();

/**
 * The promotions and transfers of a period, across the whole company.
 *
 * Two ways to read it, because there are two questions. "Movements only" is the
 * one for a review meeting — who actually moved. "Every posting in force" is the
 * one for a service audit — where everybody was, including the people who did
 * not move at all.
 */
export default function PostingsRegisterReportPage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();
  const { data: companies } = useFetch<Company[]>('/companies');

  const [from, setFrom] = useState(`${thisYear}-01-01`);
  const [to, setTo] = useState(`${thisYear}-12-31`);
  const [mode, setMode] = useState('moves');

  const { data, loading } = useFetch<RegisterRow[]>(
    `/hr-registers/postings?from=${from}&to=${to}`,
    [from, to],
  );

  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  // Grouped by employee: a service record reads down a person, not across a
  // date. Within each, oldest first — the order the moves happened in.
  const blocks = useMemo<ReportBlock[]>(() => {
    let rows = data ?? [];
    if (mode === 'moves') rows = rows.filter((r) => r.startedInPeriod);

    const byEmployee = new Map<string, RegisterRow[]>();
    for (const r of rows) {
      const key = `${r.employeeCode} — ${r.employeeName}`;
      if (!byEmployee.has(key)) byEmployee.set(key, []);
      byEmployee.get(key)!.push(r);
    }

    return [...byEmployee.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([heading, list]) => ({
        heading,
        count: list.length,
        tables: [
          {
            rows: [...list]
              .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
              .map((r) => [
                r.employeeCode,
                r.employeeName,
                formatDayMonthYear(r.effectiveFrom),
                r.effectiveTo ? formatDayMonthYear(r.effectiveTo) : 'present',
                r.designationName,
                r.branchName ?? '-',
                r.divisionName ?? '-',
                r.departmentName ?? '-',
                eventOf(r),
              ]),
          },
        ],
      }));
  }, [data, mode]);

  const total = blocks.reduce((n, b) => n + (b.count ?? 0), 0);

  const summary = useMemo(() => {
    const rows = (data ?? []).filter((r) => !(mode === 'moves' && !r.startedInPeriod));
    const promotions = rows.filter(
      (r) => r.startedInPeriod && r.changes.includes('DESIGNATION'),
    ).length;
    const transfers = rows.filter(
      (r) => r.startedInPeriod && r.changes.some((c) => c !== 'DESIGNATION'),
    ).length;
    return [
      { label: 'Employees', value: blocks.length },
      { label: 'Promotions', value: promotions },
      { label: 'Transfers', value: transfers },
      { label: 'Postings Listed', value: total },
    ];
  }, [data, mode, blocks.length, total]);

  const spec: ReportSpec = {
    companyName,
    subtitle: `Postings Register ${formatDayMonthYear(from)} to ${formatDayMonthYear(to)} - ${total} ${
      total === 1 ? 'posting' : 'postings'
    }`,
    columns: [...COLUMNS],
    weights: [...WEIGHTS],
    blocks,
    // From, To and the derived Event — dates and a short label, which read
    // badly ragged-left between two wide text columns.
    centerCols: CENTER_COLS,
    fileBase: 'postings-register',
    serial: true,
    summary,
  };

  const canPrint = can(ROUTE, 'print');
  const popupBlocked = () =>
    toast.error('Pop-up blocked — allow pop-ups to print.');

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Postings Register"
        description="Promotions and transfers over a period, by employee"
        icon={<MapPin className="h-5 w-5" />}
        actions={
          <ReportExportButtons
            canPrint={canPrint}
            canPdf={can(ROUTE, 'downloadPdf')}
            canExcel={can(ROUTE, 'downloadExcel')}
            onPreview={() => {
              if (!printReport(spec, { allowPrint: canPrint })) popupBlocked();
            }}
            onPrint={() => {
              if (!printReport(spec, { autoPrint: true })) popupBlocked();
            }}
            onPdf={() => pdfReport(spec)}
            onExcel={() => excelReport(spec, { headingLabel: 'Employee' })}
            disabled={total === 0}
          />
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <DateInput
            label="From"
            wrapClassName="w-44"
            value={from}
            onChange={setFrom}
          />
          <DateInput
            label="To"
            wrapClassName="w-44"
            value={to}
            onChange={setTo}
          />
          <Select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            wrapClassName="w-56"
            sortOptions={false}
            options={[
              { value: 'moves', label: 'Movements in the period' },
              { value: 'all', label: 'Every posting in force' },
            ]}
          />
          <span className="ml-auto text-sm text-slate-500 dark:text-slate-400">
            {total} posting{total === 1 ? '' : 's'}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <ReportView
            columns={[...COLUMNS]}
            weights={[...WEIGHTS]}
            blocks={blocks}
            loading={loading}
            centerCols={CENTER_COLS}
            serial
            summary={summary}
            emptyText="No postings in this period."
          />
        </div>
      </div>
    </div>
  );
}
