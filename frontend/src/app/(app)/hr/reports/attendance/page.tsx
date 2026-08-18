'use client';

import { useMemo, useState } from 'react';
import { CalendarCheck } from 'lucide-react';
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
import type { AttendanceRegister, Company } from '@/lib/types';

const ROUTE = '/hr/reports/attendance';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Sun … Sat, single letters — a day column is one character wide. */
const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** 615 → "10.25" — hours to two decimals, which is what a wage is worked out on. */
const hours = (minutes: number) =>
  (minutes / 60).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * The attendance register — the month on one page.
 *
 * A row per person and a column per day, each cell the type's ALIAS: P, A, SL.
 * That is the sheet this module was drawn from, and the reason attendance types
 * carry an alias at all — a full label would set a column three times the width
 * of a month.
 *
 * The counts come first, as they do on the sheet it replaces: what a manager
 * reads is "how many days did this person work", and the grid behind it is the
 * working, there to be checked rather than added up.
 */
export default function AttendanceRegisterReportPage() {
  const { can, activeCompany, activeCompanyId, activeBranchId } = useAuth();
  const toast = useToast();
  const { data: companies } = useFetch<Company[]>('/companies');

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data, loading } = useFetch<AttendanceRegister>(
    `/hr-attendance-reports/register?year=${year}&month=${month}`,
    [year, month, activeBranchId],
  );

  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  const days = useMemo(() => data?.days ?? [], [data]);
  const types = useMemo(() => data?.types ?? [], [data]);
  const rows = useMemo(() => data?.rows ?? [], [data]);

  /**
   * Only the types somebody was actually marked with get a count column.
   *
   * A register with a column for every leave the business has ever defined
   * would be mostly zeroes, and the columns it needs are the ones the month
   * actually used.
   */
  const usedTypes = useMemo(
    () =>
      types.filter((t) => rows.some((r) => (r.counts[String(t.id)] ?? 0) > 0)),
    [types, rows],
  );

  const { columns, weights, groups } = useMemo(() => {
    const fixed = ['Emp. ID', 'Employee', 'Designation'];
    const cols = [
      ...fixed,
      ...usedTypes.map((t) => t.alias),
      'Hours',
      ...days.map((d) => String(d.day)),
    ];
    // The two-tier header says which half of the page a column is in — the
    // counts on the left, the month itself on the right, with the weekday over
    // each day so a Sunday column is recognisable without counting across.
    const grp: (string | undefined)[] = [
      ...fixed.map(() => undefined),
      ...usedTypes.map(() => 'Days'),
      undefined,
      ...days.map((d) => WEEKDAY[d.weekday]),
    ];
    const w = [8, 18, 14, ...usedTypes.map(() => 4), 6, ...days.map(() => 3)];
    return { columns: cols, weights: w, groups: grp };
  }, [usedTypes, days]);

  const blocks = useMemo<ReportBlock[]>(() => {
    if (!rows.length) return [];
    return [
      {
        tables: [
          {
            rows: rows.map((r) => [
              r.employeeCode,
              r.employeeName,
              r.designationName,
              ...usedTypes.map((t) => {
                const n = r.counts[String(t.id)] ?? 0;
                return n === 0 ? '' : String(n);
              }),
              r.workedMinutes ? hours(r.workedMinutes) : '',
              ...days.map((d) => r.cells[d.date]?.alias ?? ''),
            ]),
          },
        ],
      },
    ];
  }, [rows, usedTypes, days]);

  /** The month's totals — how many of each kind of day, across everybody. */
  const summary = useMemo(
    () => [
      { label: 'Employees', value: rows.length },
      ...usedTypes.map((t) => ({
        label: t.label,
        value: rows.reduce((n, r) => n + (r.counts[String(t.id)] ?? 0), 0),
      })),
      {
        label: 'Hours',
        value:
          Math.round(rows.reduce((n, r) => n + r.workedMinutes, 0) / 0.6) / 100,
      },
    ],
    [rows, usedTypes],
  );

  const spec: ReportSpec = {
    companyName,
    subtitle: `Attendance Register — ${MONTHS[month - 1]} ${year} · ${rows.length} ${
      rows.length === 1 ? 'employee' : 'employees'
    }`,
    columns,
    weights,
    groups,
    blocks,
    fileBase: 'attendance-register',
    serial: true,
    summary,
    // The counts and the hours; the day cells are letters, not figures.
    numericCols: usedTypes.map((_, i) => 3 + i).concat([3 + usedTypes.length]),
    centerCols: days.map((_, i) => 4 + usedTypes.length + i),
  };

  const canPrint = can(ROUTE, 'print');
  const popupBlocked = () =>
    toast.error('Pop-up blocked — allow pop-ups to print.');

  const years = useMemo(() => {
    const y = new Date().getFullYear();
    return [y - 2, y - 1, y, y + 1].map((n) => ({
      value: n,
      label: String(n),
    }));
  }, []);

  return (
    <div className="mx-auto flex h-full max-w-[110rem] flex-col">
      <PageHeader
        title="Attendance Register"
        description="The month on one page — a column per day, a letter per day"
        icon={<CalendarCheck className="h-5 w-5" />}
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
            onExcel={() => excelReport(spec)}
            disabled={rows.length === 0}
          />
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <Select
            label="Month"
            wrapClassName="w-40"
            sortOptions={false}
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))}
          />
          <Select
            label="Year"
            wrapClassName="w-32"
            sortOptions={false}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            options={years}
          />
          <span className="ml-auto text-sm text-slate-500 dark:text-slate-400">
            {types.length > 0 && (
              <>{types.map((t) => `${t.alias} = ${t.label}`).join(' · ')}</>
            )}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
          <ReportView
            columns={columns}
            weights={weights}
            groups={groups}
            blocks={blocks}
            loading={loading}
            serial
            numericCols={spec.numericCols as number[]}
            centerCols={spec.centerCols as number[]}
            summary={summary}
            emptyText="Nobody was on the books this month."
          />
        </div>
      </div>
    </div>
  );
}
