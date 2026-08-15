'use client';

import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Field';
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
import type { Company, Employee } from '@/lib/types';

const ROUTE = '/hr/reports/headcount';

const NONE = '— Not stated —';

/** What the rows can be counted BY. */
const GROUPINGS = [
  { value: 'division', label: 'Division → Department' },
  { value: 'category', label: 'Category → Group' },
  { value: 'branch', label: 'Branch → Designation' },
  { value: 'grade', label: 'Grade → Designation' },
] as const;

type Grouping = (typeof GROUPINGS)[number]['value'];

/** The two levels each grouping counts by, read off an employee. */
const LEVELS: Record<
  Grouping,
  { outer: (e: Employee) => string; inner: (e: Employee) => string }
> = {
  division: {
    outer: (e) => e.divisionName ?? NONE,
    inner: (e) => e.departmentName ?? NONE,
  },
  category: {
    outer: (e) => e.categoryName ?? NONE,
    inner: (e) => e.groupName ?? NONE,
  },
  branch: {
    outer: (e) => e.branchName ?? '— Whole company —',
    inner: (e) => e.designationName ?? NONE,
  },
  grade: {
    outer: (e) => e.gradeName ?? '— No grade —',
    inner: (e) => e.designationName ?? NONE,
  },
};

const COLUMNS = ['Group', 'Male', 'Female', 'Other', 'Total'] as const;
const WEIGHTS = [44, 14, 14, 14, 14] as const;

/**
 * Headcount, counted whichever way the reader needs it.
 *
 * Numbers rather than names: this is the report somebody takes to a meeting, and
 * the Employee List is one click away when they want to know WHO. The gender
 * split is here because statutory returns ask for it, not because it is
 * interesting on its own.
 */
export default function HeadcountReportPage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();
  const { data, loading } = useFetch<Employee[]>('/hr-employees');
  const { data: companies } = useFetch<Company[]>('/companies');

  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  const [grouping, setGrouping] = useState<Grouping>('division');
  const [status, setStatus] = useState('active');

  const blocks = useMemo<ReportBlock[]>(() => {
    let rows = data ?? [];
    if (status) rows = rows.filter((r) => r.isActive === (status === 'active'));

    const { outer, inner } = LEVELS[grouping];
    // outer → inner → the tally for that cell.
    const tree = new Map<
      string,
      Map<string, { male: number; female: number; other: number }>
    >();
    for (const e of rows) {
      const o = outer(e);
      const i = inner(e);
      if (!tree.has(o)) tree.set(o, new Map());
      const level = tree.get(o)!;
      if (!level.has(i)) level.set(i, { male: 0, female: 0, other: 0 });
      const cell = level.get(i)!;
      if (e.sex === 'MALE') cell.male += 1;
      else if (e.sex === 'FEMALE') cell.female += 1;
      else cell.other += 1;
    }

    return [...tree.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([outerName, level]) => {
        const entries = [...level.entries()].sort((a, b) =>
          a[0].localeCompare(b[0]),
        );
        const count = entries.reduce(
          (n, [, c]) => n + c.male + c.female + c.other,
          0,
        );
        return {
          heading: outerName,
          count,
          tables: [
            {
              rows: entries.map(([innerName, c]) => [
                innerName,
                c.male,
                c.female,
                c.other,
                c.male + c.female + c.other,
              ]),
            },
          ],
        };
      });
  }, [data, grouping, status]);

  const totals = useMemo(() => {
    let male = 0;
    let female = 0;
    let other = 0;
    for (const b of blocks) {
      for (const t of b.tables) {
        for (const r of t.rows) {
          male += Number(r[1]) || 0;
          female += Number(r[2]) || 0;
          other += Number(r[3]) || 0;
        }
      }
    }
    return { male, female, other, total: male + female + other };
  }, [blocks]);

  const summary = useMemo(
    () => [
      { label: 'Male', value: totals.male },
      { label: 'Female', value: totals.female },
      { label: 'Other', value: totals.other },
      { label: 'Total Headcount', value: totals.total },
    ],
    [totals],
  );

  const groupingLabel =
    GROUPINGS.find((g) => g.value === grouping)?.label ?? '';

  const spec: ReportSpec = {
    companyName,
    subtitle: `Headcount Analysis by ${groupingLabel} - ${totals.total} ${
      totals.total === 1 ? 'employee' : 'employees'
    }`,
    columns: [...COLUMNS],
    weights: [...WEIGHTS],
    blocks,
    fileBase: 'headcount-analysis',
    summary,
  };

  const canPrint = can(ROUTE, 'print');
  const popupBlocked = () =>
    toast.error('Pop-up blocked — allow pop-ups to print.');

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Headcount Analysis"
        description="How many people, counted the way you need them"
        icon={<BarChart3 className="h-5 w-5" />}
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
            onExcel={() => excelReport(spec, { headingLabel: 'Group' })}
            disabled={totals.total === 0}
          />
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <Select
            value={grouping}
            onChange={(e) => setGrouping(e.target.value as Grouping)}
            wrapClassName="w-64"
            sortOptions={false}
            options={GROUPINGS.map((g) => ({ value: g.value, label: g.label }))}
          />
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            wrapClassName="w-40"
            placeholder="Active & inactive"
            sortOptions={false}
            options={[
              { value: 'active', label: 'Active only' },
              { value: 'inactive', label: 'Inactive only' },
            ]}
          />
          <span className="ml-auto text-sm text-slate-500 dark:text-slate-400">
            {totals.total} employee{totals.total === 1 ? '' : 's'}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <ReportView
            columns={[...COLUMNS]}
            weights={[...WEIGHTS]}
            blocks={blocks}
            loading={loading}
            numericCols={[1, 2, 3, 4]}
            summary={summary}
            emptyText="No employees match the current filters."
          />
        </div>
      </div>
    </div>
  );
}
