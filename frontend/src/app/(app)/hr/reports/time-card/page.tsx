'use client';

import { useMemo, useState } from 'react';
import { Clock } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { formatDayMonthYear } from '@/lib/utils';
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
import type { Company, Employee, TimeCard } from '@/lib/types';

const ROUTE = '/hr/reports/time-card';

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

const WEEKDAY = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const toTime = (m: number | null) =>
  m === null || m === undefined
    ? '—'
    : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const hours = (m: number | null) =>
  m === null || m === undefined || m === 0
    ? '—'
    : (m / 60).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

/**
 * One person's month, day by day — the time card.
 *
 * The only attendance report that shows the clock. The register answers "what
 * did the month look like"; this answers "what was I paid for", which is asked
 * by one person about one month and needs the times, not a letter.
 *
 * Every day of the month is a row, marked or not: a day that quietly vanished
 * because nobody marked it is exactly the day being queried.
 */
export default function TimeCardReportPage() {
  const { can, activeCompany, activeCompanyId } = useAuth();
  const toast = useToast();
  const { data: companies } = useFetch<Company[]>('/companies');
  const { data: employees } = useFetch<Employee[]>('/hr-employees');

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [employeeId, setEmployeeId] = useState<number | ''>('');

  const { data, loading } = useFetch<TimeCard>(
    employeeId
      ? `/hr-attendance-reports/time-card?employeeId=${employeeId}&year=${year}&month=${month}`
      : null,
    [employeeId, year, month],
  );

  const companyName = resolveCompanyName(
    companies,
    activeCompanyId,
    activeCompany?.name,
  );

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const types = useMemo(() => data?.types ?? [], [data]);

  const columns = [
    'Date',
    'Day',
    'Attendance',
    'Time In',
    'Time Out',
    'Hours',
    'Remarks',
  ];
  const weights = [12, 12, 16, 10, 10, 8, 32];

  const blocks = useMemo<ReportBlock[]>(() => {
    if (!rows.length) return [];
    return [
      {
        tables: [
          {
            rows: rows.map((r) => [
              formatDayMonthYear(r.date),
              WEEKDAY[r.weekday],
              // What the day counted as, or why there is nothing against it.
              r.typeLabel ??
                (!r.employed
                  ? '—'
                  : r.holidayName
                    ? r.holidayName
                    : r.weeklyOff
                      ? 'Weekly off'
                      : 'Not marked'),
              toTime(r.timeIn),
              toTime(r.timeOut),
              hours(r.workedMinutes),
              r.remarks ?? (r.holidayName && r.typeLabel ? r.holidayName : ''),
            ]),
            // A day that was not what the branch normally works is the one
            // worth looking at twice.
            shade: rows.map((r) => r.isException),
          },
        ],
      },
    ];
  }, [rows]);

  const summary = useMemo(() => {
    if (!data) return [];
    return [
      ...types
        .filter((t) => (data.counts[String(t.id)] ?? 0) > 0)
        .map((t) => ({
          label: t.label,
          value: data.counts[String(t.id)] ?? 0,
        })),
      {
        label: 'Hours worked',
        value: Math.round(data.workedMinutes / 0.6) / 100,
      },
      { label: 'Not marked', value: data.unmarkedDays },
    ];
  }, [data, types]);

  const spec: ReportSpec = {
    companyName,
    subtitle: data
      ? `Time Card — ${data.employee.name} (${data.employee.code}), ${data.employee.designationName} · ${MONTHS[month - 1]} ${year}`
      : `Time Card — ${MONTHS[month - 1]} ${year}`,
    columns,
    weights,
    blocks,
    fileBase: 'time-card',
    serial: false,
    summary,
    numericCols: [5],
    centerCols: [3, 4],
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
    <div className="mx-auto flex h-full max-w-6xl flex-col">
      <PageHeader
        title="Time Card"
        description="One person, one month — what they were marked as, and the hours behind it"
        icon={<Clock className="h-5 w-5" />}
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
            disabled={!data || rows.length === 0}
          />
        }
      />

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <Select
            label="Employee"
            wrapClassName="w-72"
            value={employeeId}
            placeholder="Choose an employee…"
            onChange={(e) => setEmployeeId(Number(e.target.value) || '')}
            options={(employees ?? []).map((e) => ({
              value: e.id,
              label: `${e.code} — ${e.name}`,
            }))}
          />
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
          {data && (
            <span className="ml-auto text-sm text-slate-500 dark:text-slate-400">
              Normally {toTime(data.employee.defaultTimeIn)} –{' '}
              {toTime(data.employee.defaultTimeOut)}
              {data.unmarkedDays > 0 && (
                <span className="ml-2 text-amber-600 dark:text-amber-400">
                  · {data.unmarkedDays} day
                  {data.unmarkedDays === 1 ? '' : 's'} not marked
                </span>
              )}
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
          {!employeeId ? (
            <p className="p-6 text-sm text-slate-400">
              Choose an employee to see their month.
            </p>
          ) : (
            <ReportView
              columns={columns}
              weights={weights}
              blocks={blocks}
              loading={loading}
              numericCols={[5]}
              centerCols={[3, 4]}
              summary={summary}
              emptyText="Nothing was marked for this month."
            />
          )}
        </div>
      </div>
    </div>
  );
}
